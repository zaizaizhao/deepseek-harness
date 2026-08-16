/** Validated deployment policy for Luna vision delegation. */

import { isIP } from 'node:net'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { Config } from './index.ts'

/** Fully materialized policy used by runtime code. */
export interface ResolvedConfig {
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
  readonly toolName: string
  readonly enableRunInBackground: boolean
  readonly maxDepth: number
  readonly maxConcurrency: number
  readonly cacheMaxEntries: number
  readonly maxQuestionBytes: number
  readonly visionTimeoutMs: number
  readonly allowedUrlOrigins: readonly string[]
  readonly urlTimeoutMs: number
  readonly maxRedirects: number
  readonly maxUrlLength: number
}

const DEFAULTS: ResolvedConfig = Object.freeze({
  provider: 'zaizaizhao',
  model: 'gpt-5.6-luna',
  maxTokens: 4096,
  toolName: 'gpt_luna_vision',
  enableRunInBackground: true,
  maxDepth: 1,
  maxConcurrency: 1,
  cacheMaxEntries: 256,
  maxQuestionBytes: 16 * 1024,
  visionTimeoutMs: 120_000,
  allowedUrlOrigins: Object.freeze([]),
  urlTimeoutMs: 20_000,
  maxRedirects: 3,
  maxUrlLength: 4096,
})

const CONFIG_KEYS = new Set<keyof Config>([
  'provider',
  'model',
  'maxTokens',
  'toolName',
  'enableRunInBackground',
  'maxDepth',
  'maxConcurrency',
  'cacheMaxEntries',
  'maxQuestionBytes',
  'visionTimeoutMs',
  'allowedUrlOrigins',
  'urlTimeoutMs',
  'maxRedirects',
  'maxUrlLength',
])

/**
 * Resolve direct-apply omissions and validate normalized HTTPS origins.
 * @param config - optional non-secret deployment policy.
 * @returns immutable, fully materialized runtime configuration.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const unknown = Object.keys(config).filter(key => !CONFIG_KEYS.has(key as keyof Config))
  if (unknown.length > 0) {
    throw new TypeError(`tool-vision-luna: unknown configuration field(s): ${unknown.join(', ')}`)
  }
  const resolved: ResolvedConfig = {
    provider: config.provider ?? DEFAULTS.provider,
    model: config.model ?? DEFAULTS.model,
    maxTokens: config.maxTokens ?? DEFAULTS.maxTokens,
    toolName: config.toolName ?? DEFAULTS.toolName,
    enableRunInBackground: config.enableRunInBackground ?? DEFAULTS.enableRunInBackground,
    maxDepth: config.maxDepth ?? DEFAULTS.maxDepth,
    maxConcurrency: config.maxConcurrency ?? DEFAULTS.maxConcurrency,
    cacheMaxEntries: config.cacheMaxEntries ?? DEFAULTS.cacheMaxEntries,
    maxQuestionBytes: config.maxQuestionBytes ?? DEFAULTS.maxQuestionBytes,
    visionTimeoutMs: config.visionTimeoutMs ?? DEFAULTS.visionTimeoutMs,
    allowedUrlOrigins: config.allowedUrlOrigins ?? DEFAULTS.allowedUrlOrigins,
    urlTimeoutMs: config.urlTimeoutMs ?? DEFAULTS.urlTimeoutMs,
    maxRedirects: config.maxRedirects ?? DEFAULTS.maxRedirects,
    maxUrlLength: config.maxUrlLength ?? DEFAULTS.maxUrlLength,
  }
  const strings = [['provider', resolved.provider], ['model', resolved.model], ['toolName', resolved.toolName]] as const
  for (const [name, value] of strings) {
    if (value.trim().length === 0) throw new TypeError(`tool-vision-luna: ${name} must be a non-empty string`)
  }
  const positive = [
    ['maxTokens', resolved.maxTokens],
    ['maxConcurrency', resolved.maxConcurrency],
    ['cacheMaxEntries', resolved.cacheMaxEntries],
    ['maxQuestionBytes', resolved.maxQuestionBytes],
    ['visionTimeoutMs', resolved.visionTimeoutMs],
    ['urlTimeoutMs', resolved.urlTimeoutMs],
    ['maxUrlLength', resolved.maxUrlLength],
  ] as const
  for (const [name, value] of positive) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`tool-vision-luna: ${name} must be a positive safe integer`)
    }
  }
  if (!Number.isSafeInteger(resolved.maxDepth) || resolved.maxDepth < 0) {
    throw new TypeError('tool-vision-luna: maxDepth must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxRedirects) || resolved.maxRedirects < 0) {
    throw new TypeError('tool-vision-luna: maxRedirects must be a non-negative safe integer')
  }
  if (resolved.maxRedirects > 20) {
    throw new TypeError('tool-vision-luna: maxRedirects must not exceed 20')
  }
  if (resolved.visionTimeoutMs > MAX_TIMER_DELAY_MS || resolved.urlTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`tool-vision-luna: timeout values must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const origins = resolved.allowedUrlOrigins.map((value) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new TypeError(`tool-vision-luna: allowedUrlOrigins contains invalid URL ${JSON.stringify(value)}`)
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new TypeError(`tool-vision-luna: allowed URL origin must be an exact HTTPS origin, got ${JSON.stringify(value)}`)
    }
    const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
    if (isIP(hostname) !== 0) {
      throw new TypeError(`tool-vision-luna: allowed URL origin must use a DNS hostname, got ${JSON.stringify(value)}`)
    }
    return url.origin
  })
  if (new Set(origins).size !== origins.length) {
    throw new TypeError('tool-vision-luna: allowedUrlOrigins must not contain duplicates')
  }
  return Object.freeze({
    provider: resolved.provider,
    model: resolved.model,
    maxTokens: resolved.maxTokens,
    toolName: resolved.toolName,
    enableRunInBackground: resolved.enableRunInBackground,
    maxDepth: resolved.maxDepth,
    maxConcurrency: resolved.maxConcurrency,
    cacheMaxEntries: resolved.cacheMaxEntries,
    maxQuestionBytes: resolved.maxQuestionBytes,
    visionTimeoutMs: resolved.visionTimeoutMs,
    allowedUrlOrigins: Object.freeze(origins),
    urlTimeoutMs: resolved.urlTimeoutMs,
    maxRedirects: resolved.maxRedirects,
    maxUrlLength: resolved.maxUrlLength,
  })
}
