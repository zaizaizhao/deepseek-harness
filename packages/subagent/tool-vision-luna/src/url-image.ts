/** HTTPS allowlist, DNS pinning, redirect validation, and bounded image download. */

import { lookup as dnsLookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { Agent as UndiciAgent, fetch } from 'undici'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedConfig } from './config.ts'
import { VisionError, visionAbort } from './errors.ts'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const URL_TIMEOUT_CODE = 'VISION_URL_DOWNLOAD_TIMEOUT'

interface PublicAddress {
  readonly address: string
  readonly family: 4 | 6
}

/**
 * Whether one literal IP is globally routable unicast after mapped-v6 normalization.
 * @param value - IPv4 or IPv6 literal.
 * @returns true only for a public unicast address.
 */
export function isPublicAddress(value: string): boolean {
  try {
    return ipaddr.process(value).range() === 'unicast'
  } catch {
    return false
  }
}

/** Resolve every DNS answer once within the caller deadline and reject any non-public address. */
async function resolvePublicAddress(hostname: string, signal: AbortSignal): Promise<PublicAddress> {
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => { rejectAbort?.(visionAbort(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  let answers: Array<{ address: string; family: number }>
  try {
    answers = await Promise.race([
      dnsLookup(hostname, { all: true, order: 'verbatim' }),
      aborted,
    ])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  if (answers.length === 0 || answers.some(answer => !isPublicAddress(answer.address))) {
    throw new VisionError(`URL host ${JSON.stringify(hostname)} did not resolve exclusively to public addresses`, 'VISION_URL_FORBIDDEN')
  }
  const answer = answers[0]
  /* v8 ignore next -- non-empty answers proves the first element exists. */
  if (answer === undefined) throw new VisionError('URL host returned no address', 'VISION_URL_NETWORK')
  if (answer.family !== 4 && answer.family !== 6) {
    throw new VisionError(`URL host returned unsupported address family ${String(answer.family)}`, 'VISION_URL_NETWORK')
  }
  return { address: answer.address, family: answer.family }
}

/**
 * Parse and enforce the exact HTTPS-origin and IP-literal policy.
 * @param raw - caller-supplied URL.
 * @param config - normalized URL policy.
 * @returns validated URL object.
 */
export function validateRemoteUrl(raw: string, config: ResolvedConfig): URL {
  if (raw.length === 0 || raw.length > config.maxUrlLength) {
    throw new VisionError(`URL must contain 1-${config.maxUrlLength} characters`, 'VISION_INVALID_ASSET')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new VisionError('visual asset URL is invalid', 'VISION_INVALID_ASSET')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new VisionError('visual asset URLs must use HTTPS and contain no credentials', 'VISION_URL_FORBIDDEN')
  }
  if (!config.allowedUrlOrigins.includes(url.origin)) {
    throw new VisionError(`visual asset URL origin ${JSON.stringify(url.origin)} is not allowed`, 'VISION_URL_FORBIDDEN')
  }
  const literal = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  if (ipaddr.isValid(literal)) {
    throw new VisionError('visual asset URL host must be a DNS name, not an IP literal', 'VISION_URL_FORBIDDEN')
  }
  return url
}

/** Read a response body without ever buffering more than the deployment image cap. */
async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new VisionError(`remote image exceeds the ${maxBytes}-byte limit`, 'VISION_INVALID_ASSET')
  }
  const body = response.body
  if (body === null) throw new VisionError('remote image response has no body', 'VISION_URL_NETWORK')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let completed = false
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        completed = true
        break
      }
      size += next.value.byteLength
      if (size > maxBytes) {
        throw new VisionError(`remote image exceeds the ${maxBytes}-byte limit`, 'VISION_INVALID_ASSET')
      }
      chunks.push(next.value)
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {
        // The original read failure remains authoritative; cancellation is best-effort cleanup.
      })
    }
    reader.releaseLock()
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/** Preserve timeout classification and caller cancellation after asynchronous network steps. */
function assertDownloadActive(signal: AbortSignal, cause?: unknown): void {
  if (!signal.aborted) return
  const timeout = timeoutOf(signal, URL_TIMEOUT_CODE)
  if (timeout !== undefined) {
    throw new VisionError(
      `visual asset download timed out after ${timeout.timeoutMs}ms`,
      'VISION_URL_TIMEOUT',
      { cause },
    )
  }
  throw visionAbort(signal)
}

/**
 * Download one allowed image while pinning the public DNS answer used by the socket.
 * @param raw - caller-supplied URL.
 * @param config - resolved allowlist and redirect/deadline policy.
 * @param maxBytes - inclusive complete-body cap.
 * @param signal - caller and lifecycle cancellation.
 * @returns complete bounded bytes and the final redacted URL.
 */
export async function downloadRemoteImage(
  raw: string,
  config: ResolvedConfig,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ readonly data: Uint8Array; readonly finalUrl: URL }> {
  let current = validateRemoteUrl(raw, config)
  using d = deadline(signal, config.urlTimeoutMs, URL_TIMEOUT_CODE)
  for (let redirects = 0; ; redirects += 1) {
    assertDownloadActive(d.signal)
    let answer: PublicAddress
    try {
      answer = await resolvePublicAddress(current.hostname, d.signal)
    } catch (error: unknown) {
      assertDownloadActive(d.signal, error)
      if (error instanceof VisionError) throw error
      throw new VisionError('visual asset DNS lookup failed', 'VISION_URL_NETWORK', { cause: error })
    }
    assertDownloadActive(d.signal)
    const dispatcher = new UndiciAgent({
      connect: {
        lookup(_hostname, _options, callback) {
          callback(null, answer.address, answer.family)
        },
      },
    })
    try {
      let response: Response
      try {
        response = await fetch(current, { dispatcher, redirect: 'manual', signal: d.signal }) as unknown as Response
      } catch (error: unknown) {
        assertDownloadActive(d.signal, error)
        throw new VisionError('visual asset download failed', 'VISION_URL_NETWORK', { cause: error })
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (location === null) throw new VisionError('visual asset redirect omitted Location', 'VISION_URL_NETWORK')
        if (redirects >= config.maxRedirects) {
          throw new VisionError(`visual asset exceeded ${config.maxRedirects} redirects`, 'VISION_URL_FORBIDDEN')
        }
        let redirected: URL
        try {
          redirected = new URL(location, current)
        } catch (error: unknown) {
          throw new VisionError('visual asset redirect Location is invalid', 'VISION_URL_NETWORK', { cause: error })
        }
        current = validateRemoteUrl(redirected.href, config)
        continue
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel()
        throw new VisionError(`visual asset server returned HTTP ${response.status}`, 'VISION_URL_NETWORK')
      }
      return { data: await readBoundedBody(response, maxBytes), finalUrl: current }
    } finally {
      await dispatcher.close()
    }
  }
}
