import { describe, expect, it, vi } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { VisionCache } from '../src/cache.ts'
import { VisionCapacity } from '../src/capacity.ts'
import { Config, resolveConfig } from '../src/index.ts'
import { VisionError, visionAbort } from '../src/errors.ts'

describe('Luna vision configuration', () => {
  it('materializes the non-secret defaults and normalizes exact HTTPS origins', () => {
    expect(resolveConfig({})).toMatchObject({
      provider: 'zaizaizhao',
      model: 'gpt-5.6-luna',
      maxTokens: 4096,
      toolName: 'gpt_luna_vision',
      enableRunInBackground: true,
      maxDepth: 1,
      maxConcurrency: 1,
      allowedUrlOrigins: [],
    })
    const resolved = resolveConfig({
      provider: 'vision-route',
      model: 'vision-model',
      toolName: 'look',
      maxTokens: 12,
      maxConcurrency: 2,
      cacheMaxEntries: 3,
      maxQuestionBytes: 4,
      visionTimeoutMs: 5,
      urlTimeoutMs: 6,
      maxUrlLength: 7,
      maxDepth: 0,
      maxRedirects: 0,
      allowedUrlOrigins: ['https://EXAMPLE.com:443'],
    })
    expect(resolved.allowedUrlOrigins).toEqual(['https://example.com'])
    expect(Object.isFrozen(resolved.allowedUrlOrigins)).toBe(true)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.keys(Config({}))).not.toContain('apiKey')
    expect(() => resolveConfig(Config({ apiKey: 'must-not-enter-plugin-config' } as never)))
      .toThrow('unknown configuration field(s): apiKey')
  })

  it.each([
    [{ provider: ' ' }, 'provider'],
    [{ model: '' }, 'model'],
    [{ toolName: '\t' }, 'toolName'],
    [{ maxTokens: 0 }, 'maxTokens'],
    [{ maxConcurrency: 1.5 }, 'maxConcurrency'],
    [{ cacheMaxEntries: Number.POSITIVE_INFINITY }, 'cacheMaxEntries'],
    [{ maxQuestionBytes: -1 }, 'maxQuestionBytes'],
    [{ visionTimeoutMs: 0 }, 'visionTimeoutMs'],
    [{ urlTimeoutMs: 0 }, 'urlTimeoutMs'],
    [{ maxUrlLength: 0 }, 'maxUrlLength'],
    [{ maxDepth: -1 }, 'maxDepth'],
    [{ maxRedirects: -1 }, 'maxRedirects'],
    [{ maxRedirects: 21 }, 'maxRedirects'],
    [{ visionTimeoutMs: MAX_TIMER_DELAY_MS + 1 }, 'timeout values'],
    [{ urlTimeoutMs: MAX_TIMER_DELAY_MS + 1 }, 'timeout values'],
  ] as const)('rejects invalid policy %j', (input, fragment) => {
    expect(() => resolveConfig(input)).toThrow(fragment)
  })

  it.each([
    [['not a URL'], 'invalid URL'],
    [['http://example.com'], 'exact HTTPS origin'],
    [['https://user@example.com'], 'exact HTTPS origin'],
    [['https://example.com/path'], 'exact HTTPS origin'],
    [['https://example.com?x=1'], 'exact HTTPS origin'],
    [['https://example.com#x'], 'exact HTTPS origin'],
    [['https://8.8.8.8'], 'DNS hostname'],
    [['https://[2001:4860:4860::8888]'], 'DNS hostname'],
    [['https://example.com', 'https://EXAMPLE.com:443'], 'duplicates'],
  ] as const)('rejects invalid URL allowlist %j', (allowedUrlOrigins, fragment) => {
    expect(() => resolveConfig({ allowedUrlOrigins: [...allowedUrlOrigins] })).toThrow(fragment)
  })
})

describe('VisionCache', () => {
  it('promotes hits, replaces keys, evicts LRU entries, and clears', () => {
    expect(() => new VisionCache(0)).toThrow('positive safe integer')
    expect(() => new VisionCache(1.5)).toThrow('positive safe integer')
    const cache = new VisionCache<number>(2)
    expect(cache.get('missing')).toBeUndefined()
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('b', 20)
    cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(20)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('VisionCapacity', () => {
  it('runs FIFO, releases after failure, and exposes admission counts', async () => {
    expect(() => new VisionCapacity(0)).toThrow('positive safe integer')
    expect(() => new VisionCapacity(Number.NaN)).toThrow('positive safe integer')
    const capacity = new VisionCapacity(1)
    const gate = Promise.withResolvers<undefined>()
    const order: string[] = []
    const first = capacity.run(new AbortController().signal, async () => {
      order.push('first-start')
      await gate.promise
      order.push('first-end')
    })
    await vi.waitFor(() => { expect(capacity.activeCount).toBe(1) })
    const second = capacity.run(new AbortController().signal, async () => { order.push('second') })
    expect(capacity.queuedCount).toBe(1)
    gate.resolve(undefined)
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
    expect(capacity.activeCount).toBe(0)
    await expect(capacity.run(new AbortController().signal, () => Promise.reject(new Error('boom'))))
      .rejects.toThrow('boom')
    expect(capacity.activeCount).toBe(0)
  })

  it('rejects pre-aborted, queued-aborted, closed, and close-queued admission', async () => {
    const capacity = new VisionCapacity(1)
    const pre = new AbortController()
    pre.abort('pre')
    await expect(capacity.run(pre.signal, () => Promise.resolve())).rejects.toMatchObject({
      code: 'VISION_CANCELLED', cause: 'pre',
    })

    const gate = Promise.withResolvers<undefined>()
    const first = capacity.run(new AbortController().signal, () => gate.promise)
    const queuedController = new AbortController()
    const queued = capacity.run(queuedController.signal, () => Promise.resolve())
    queuedController.abort('queued')
    await expect(queued).rejects.toMatchObject({ code: 'VISION_CANCELLED', cause: 'queued' })

    const closing = capacity.run(new AbortController().signal, () => Promise.resolve())
    capacity.close()
    capacity.close()
    await expect(closing).rejects.toMatchObject({ code: 'VISION_UNAVAILABLE' })
    gate.resolve(undefined)
    await first
    await expect(capacity.run(new AbortController().signal, () => Promise.resolve()))
      .rejects.toMatchObject({ code: 'VISION_UNAVAILABLE' })
  })
})

describe('VisionError', () => {
  it('retains stable codes and cancellation causes', () => {
    const cause = new Error('cause')
    const error = new VisionError('bad image', 'VISION_INVALID_ASSET', { cause })
    expect(error).toMatchObject({ name: 'VisionError', code: 'VISION_INVALID_ASSET', cause })
    const controller = new AbortController()
    controller.abort('user stopped')
    expect(visionAbort(controller.signal)).toMatchObject({
      name: 'VisionError', code: 'VISION_CANCELLED', cause: 'user stopped',
    })
  })
})
