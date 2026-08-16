import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config, PNG } from './helpers.ts'

type LookupCallback = (error: Error | null, address: string, family: 4 | 6) => void
type Lookup = (hostname: string, options: unknown, callback: LookupCallback) => void

const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  fetch: vi.fn(),
  closed: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({ lookup: mocks.dnsLookup }))
vi.mock('undici', () => ({
  Agent: class MockUndiciAgent {
    readonly lookup: Lookup

    constructor(options: { connect: { lookup: Lookup } }) {
      this.lookup = options.connect.lookup
    }

    close(): Promise<void> {
      mocks.closed()
      return Promise.resolve()
    }
  },
  fetch: mocks.fetch,
}))

const { downloadRemoteImage, isPublicAddress, validateRemoteUrl } = await import('../src/url-image.ts')

const policy = (overrides: Parameters<typeof config>[0] = {}) => config({
  allowedUrlOrigins: Object.freeze(['https://images.example']),
  maxRedirects: 2,
  maxUrlLength: 256,
  urlTimeoutMs: 50,
  ...overrides,
})

interface FetchOptions {
  readonly dispatcher: { readonly lookup: Lookup }
  readonly signal: AbortSignal
}

async function pin(options: FetchOptions, hostname = 'images.example'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    options.dispatcher.lookup(hostname, {}, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}

const reply = (response: Response) => async (url: URL, options: FetchOptions): Promise<Response> => {
  await pin(options, url.hostname)
  return response
}

beforeEach(() => {
  vi.useRealTimers()
  mocks.dnsLookup.mockReset()
  mocks.fetch.mockReset()
  mocks.closed.mockReset()
  mocks.dnsLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
})

describe('remote URL policy', () => {
  it('recognizes only globally routable unicast literals', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true)
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('10.0.0.1')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('not-an-ip')).toBe(false)
  })

  it('accepts an exact allowed HTTPS origin and rejects malformed or unsafe URLs', () => {
    expect(validateRemoteUrl('https://images.example/a.png?x=1', policy()).href)
      .toBe('https://images.example/a.png?x=1')
    expect(() => validateRemoteUrl('https://8.8.8.8/a.png', policy({
      allowedUrlOrigins: Object.freeze(['https://8.8.8.8']),
    }))).toThrow('not an IP literal')
    expect(() => validateRemoteUrl('', policy())).toThrow('1-256 characters')
    expect(() => validateRemoteUrl(`https://images.example/${'x'.repeat(300)}`, policy())).toThrow('1-256 characters')
    expect(() => validateRemoteUrl('not a URL', policy())).toThrow('URL is invalid')
    expect(() => validateRemoteUrl('http://images.example/a', policy())).toThrow('must use HTTPS')
    expect(() => validateRemoteUrl('https://user:pass@images.example/a', policy())).toThrow('contain no credentials')
    expect(() => validateRemoteUrl('https://other.example/a', policy())).toThrow('is not allowed')
    expect(() => validateRemoteUrl('https://127.0.0.1/a', policy({
      allowedUrlOrigins: Object.freeze(['https://127.0.0.1']),
    }))).toThrow('not an IP literal')
    expect(() => validateRemoteUrl('https://[::1]/a', policy({
      allowedUrlOrigins: Object.freeze(['https://[::1]']),
    }))).toThrow('not an IP literal')
  })
})

describe('downloadRemoteImage', () => {
  it('pins public DNS, reads a chunked bounded body, and closes the dispatcher', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PNG.subarray(0, 10))
        controller.enqueue(PNG.subarray(10))
        controller.close()
      },
    })
    mocks.fetch.mockImplementationOnce(reply(new Response(stream, { status: 200 })))
    const result = await downloadRemoteImage(
      'https://images.example/a.png',
      policy(),
      PNG.byteLength,
      new AbortController().signal,
    )
    expect(result.data).toEqual(PNG)
    expect(result.finalUrl.href).toBe('https://images.example/a.png')
    expect(mocks.dnsLookup).toHaveBeenCalledWith('images.example', { all: true, order: 'verbatim' })
    expect(mocks.closed).toHaveBeenCalledOnce()
  })

  it('accepts a valid Content-Length and follows a revalidated relative redirect', async () => {
    mocks.fetch
      .mockImplementationOnce(reply(new Response('redirect', {
        status: 302,
        headers: { location: '/final.png' },
      })))
      .mockImplementationOnce(reply(new Response(PNG, {
        status: 200,
        headers: { 'content-length': String(PNG.byteLength) },
      })))
    const result = await downloadRemoteImage(
      'https://images.example/start',
      policy(),
      PNG.byteLength,
      new AbortController().signal,
    )
    expect(result.finalUrl.href).toBe('https://images.example/final.png')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.dnsLookup).toHaveBeenCalledTimes(2)
    expect(mocks.closed).toHaveBeenCalledTimes(2)
  })

  it.each([
    [new Response(PNG, { status: 200, headers: { 'content-length': 'invalid' } }), 100, 'exceeds'],
    [new Response(PNG, { status: 200, headers: { 'content-length': '1000' } }), 100, 'exceeds'],
    [new Response(null, { status: 200 }), 100, 'no body'],
  ] as const)('rejects invalid response body metadata', async (response, maxBytes, fragment) => {
    mocks.fetch.mockImplementationOnce(reply(response))
    await expect(downloadRemoteImage(
      'https://images.example/a.png', policy(), maxBytes, new AbortController().signal,
    )).rejects.toThrow(fragment)
    expect(mocks.closed).toHaveBeenCalledOnce()
  })

  it('cancels an over-limit streaming body without hiding the admission failure', async () => {
    const cancel = vi.fn(() => { throw new Error('cancel cleanup failed') })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)) },
      cancel,
    })
    mocks.fetch.mockImplementationOnce(reply(new Response(stream, { status: 200 })))
    await expect(downloadRemoteImage(
      'https://images.example/a.png', policy(), 2, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_INVALID_ASSET' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects redirect and HTTP failures with stable codes', async () => {
    mocks.fetch.mockImplementationOnce(reply(new Response(null, { status: 302 })))
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_NETWORK' })

    mocks.fetch.mockImplementationOnce(reply(new Response('again', {
      status: 302, headers: { location: '/again' },
    })))
    await expect(downloadRemoteImage(
      'https://images.example/a', policy({ maxRedirects: 0 }), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_FORBIDDEN' })

    mocks.fetch.mockImplementationOnce(reply(new Response('move', {
      status: 302, headers: { location: 'https://other.example/a' },
    })))
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_FORBIDDEN' })

    mocks.fetch.mockImplementationOnce(reply(new Response('broken', {
      status: 302, headers: { location: 'https://[broken' },
    })))
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_NETWORK' })

    mocks.fetch.mockImplementationOnce(reply(new Response(null, { status: 404 })))
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_NETWORK' })
  })

  it('rejects empty, mixed-private, unsupported-family, and failed DNS results', async () => {
    mocks.dnsLookup.mockResolvedValueOnce([])
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_FORBIDDEN' })

    mocks.dnsLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_FORBIDDEN' })

    mocks.dnsLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 0 }])
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_NETWORK' })

    const dnsFailure = new Error('resolver unavailable')
    mocks.dnsLookup.mockRejectedValueOnce(dnsFailure)
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_NETWORK', cause: dnsFailure })
  })

  it('maps fetch rejection, timeout, and caller cancellation independently', async () => {
    const network = new Error('socket failed')
    mocks.fetch.mockRejectedValueOnce(network)
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_NETWORK', cause: network })

    vi.useFakeTimers()
    mocks.fetch.mockImplementationOnce((_url: URL, options: FetchOptions) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new Error('fetch aborted', { cause: options.signal.reason }))
      }, { once: true })
    }))
    const timed = downloadRemoteImage(
      'https://images.example/a', policy({ urlTimeoutMs: 10 }), 100, new AbortController().signal,
    )
    const timedResult = expect(timed).rejects.toMatchObject({ code: 'VISION_URL_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(11)
    await timedResult
    vi.useRealTimers()

    const controller = new AbortController()
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve })
    mocks.fetch.mockImplementationOnce((_url: URL, options: FetchOptions) => new Promise((_resolve, reject) => {
      markFetchStarted?.()
      options.signal.addEventListener('abort', () => {
        reject(new Error('fetch aborted', { cause: options.signal.reason }))
      }, { once: true })
    }))
    const cancelled = downloadRemoteImage('https://images.example/a', policy(), 100, controller.signal)
    await fetchStarted
    controller.abort('caller stopped')
    await expect(cancelled).rejects.toMatchObject({ code: 'VISION_CANCELLED' })
  })

  it('bounds DNS waiting and handles a signal already cancelled before dispatch', async () => {
    vi.useFakeTimers()
    mocks.dnsLookup.mockReturnValueOnce(new Promise(() => {}))
    const timed = downloadRemoteImage(
      'https://images.example/a', policy({ urlTimeoutMs: 10 }), 100, new AbortController().signal,
    )
    const timedResult = expect(timed).rejects.toMatchObject({ code: 'VISION_URL_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(11)
    await timedResult
    vi.useRealTimers()

    const controller = new AbortController()
    controller.abort('before dispatch')
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, controller.signal,
    )).rejects.toMatchObject({ code: 'VISION_CANCELLED' })
  })

  it('distinguishes cancellation during DNS, after DNS, and between redirects', async () => {
    const duringDns = new AbortController()
    mocks.dnsLookup.mockReturnValueOnce(new Promise(() => {}))
    const dnsPending = downloadRemoteImage(
      'https://images.example/a', policy(), 100, duringDns.signal,
    )
    await vi.waitFor(() => { expect(mocks.dnsLookup).toHaveBeenCalled() })
    duringDns.abort('during DNS')
    await expect(dnsPending).rejects.toMatchObject({ code: 'VISION_CANCELLED' })

    const afterDns = new AbortController()
    let addressReads = 0
    mocks.dnsLookup.mockResolvedValueOnce([{
      get address() {
        addressReads += 1
        if (addressReads === 2) afterDns.abort('after DNS')
        return '8.8.8.8'
      },
      family: 4,
    }])
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, afterDns.signal,
    )).rejects.toMatchObject({ code: 'VISION_CANCELLED' })

    const betweenRedirects = new AbortController()
    mocks.fetch.mockImplementationOnce(async (url: URL, options: FetchOptions) => {
      await pin(options, url.hostname)
      betweenRedirects.abort('between redirects')
      return new Response('move', { status: 302, headers: { location: '/next' } })
    })
    await expect(downloadRemoteImage(
      'https://images.example/a', policy(), 100, betweenRedirects.signal,
    )).rejects.toMatchObject({ code: 'VISION_CANCELLED' })
  })

  it('reports timeout after DNS resolution and between redirects', async () => {
    vi.useFakeTimers()
    let addressReads = 0
    mocks.dnsLookup.mockResolvedValueOnce([{
      get address() {
        addressReads += 1
        if (addressReads === 2) vi.advanceTimersByTime(11)
        return '8.8.8.8'
      },
      family: 4,
    }])
    await expect(downloadRemoteImage(
      'https://images.example/a', policy({ urlTimeoutMs: 10 }), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_TIMEOUT' })

    mocks.fetch.mockImplementationOnce(async (url: URL, options: FetchOptions) => {
      await pin(options, url.hostname)
      vi.advanceTimersByTime(11)
      return new Response('move', { status: 302, headers: { location: '/next' } })
    })
    await expect(downloadRemoteImage(
      'https://images.example/a', policy({ urlTimeoutMs: 10 }), 100, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_URL_TIMEOUT' })
    vi.useRealTimers()
  })
})
