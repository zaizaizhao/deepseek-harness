import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError, ProviderRequestId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { VisionCapacity } from '../src/capacity.ts'
import {
  resolveVisionQuestion,
  resolveVisionRegion,
  visionCacheKey,
  VISION_EVIDENCE_SCHEMA,
  VisionRunner,
} from '../src/vision.ts'
import { asset, config, fakeAgent } from './helpers.ts'

const EVIDENCE = Object.freeze({
  answer: 'A red square.',
  ocr: '',
  observations: Object.freeze([{ region: 'center', fact: 'One red square is visible.' }]),
  uncertainty: Object.freeze(['Color depends on display calibration.']),
})

interface RuntimeFixture {
  readonly ctx: Context
  readonly resolveModelInfo: ReturnType<typeof vi.fn>
  readonly start: ReturnType<typeof vi.fn>
}

function runtime(startImpl?: (request: SubagentStartRequest) => Promise<SubagentRun>): RuntimeFixture {
  const resolveModelInfo = vi.fn(async (provider: string, model: string) => ({
    provider,
    id: model,
    name: model,
    inputModalities: ['text', 'image'] as const,
  }))
  const start = vi.fn(async (_provider: string, request: SubagentStartRequest) =>
    (startImpl === undefined ? run() : startImpl(request)))
  return {
    ctx: { llm: { resolveModelInfo }, subagents: { start } } as unknown as Context,
    resolveModelInfo,
    start,
  }
}

function result(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    output: [{ type: 'text', text: 'visible child text' }],
    structured: EVIDENCE,
    stopReason: 'completed',
    ...overrides,
  }
}

function run(overrides: {
  readonly id?: string
  readonly localAgent?: SubagentRun['localAgent']
  readonly result?: Promise<SubagentResult>
  readonly dispose?: () => Promise<void>
} = {}): SubagentRun {
  return {
    id: SessionId(overrides.id ?? 'child-1'),
    localAgent: overrides.localAgent,
    result: overrides.result ?? Promise.resolve(result()),
    dispose: overrides.dispose ?? (() => Promise.resolve()),
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('vision input policy', () => {
  it('trims questions and enforces non-empty and UTF-8 byte limits', () => {
    expect(resolveVisionQuestion('  what is shown?  ', 20)).toBe('what is shown?')
    expect(() => resolveVisionQuestion(' \n ', 20)).toThrow(/non-empty/)
    expect(() => resolveVisionQuestion('图像', 5)).toThrow(/5-byte/)
  })

  it('accepts a detached in-bounds region and rejects every invalid relation', () => {
    const input = { x: 0, y: 0, width: 1, height: 1 }
    const resolved = resolveVisionRegion(input, [asset()])
    expect(resolved).toEqual(input)
    expect(resolved).not.toBe(input)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(resolveVisionRegion(undefined, [asset()])).toBeUndefined()
    expect(() => resolveVisionRegion(input, [asset('a'), asset('b')])).toThrow(/exactly one/)
    expect(() => resolveVisionRegion({ x: -1, y: 0, width: 1, height: 1 }, [asset()])).toThrow(/non-negative/)
    expect(() => resolveVisionRegion({ x: 0.5, y: 0, width: 1, height: 1 }, [asset()])).toThrow(/integer/)
    expect(() => resolveVisionRegion({ x: 0, y: 0, width: 2, height: 1 }, [asset()])).toThrow(/exceeds/)
  })

  it('keys parent Session, ordered assets, question, region, provider, model, tokens, and prompt version', () => {
    const first = visionCacheKey('parent-a', [asset('a'), asset('b')], 'what?', undefined, config())
    expect(first).toHaveLength(64)
    expect(visionCacheKey('parent-b', [asset('a'), asset('b')], 'what?', undefined, config())).not.toBe(first)
    expect(visionCacheKey('parent-a', [asset('b'), asset('a')], 'what?', undefined, config())).not.toBe(first)
    expect(visionCacheKey('parent-a', [asset('a'), asset('b')], 'why?', undefined, config())).not.toBe(first)
    expect(visionCacheKey('parent-a', [asset('a'), asset('b')], 'what?', { x: 0, y: 0, width: 1, height: 1 }, config())).not.toBe(first)
    expect(visionCacheKey('parent-a', [asset('a'), asset('b')], 'what?', undefined, config({ provider: 'other' }))).not.toBe(first)
    expect(visionCacheKey('parent-a', [asset('a'), asset('b')], 'what?', undefined, config({ model: 'other' }))).not.toBe(first)
    expect(visionCacheKey('parent-a', [asset('a'), asset('b')], 'what?', undefined, config({ maxTokens: 10 }))).not.toBe(first)
  })
})

describe('VisionRunner', () => {
  it('sends one isolated text-plus-image child request and deep-freezes the traced result', async () => {
    const fixture = runtime()
    const dispose = vi.fn(async () => {})
    fixture.start.mockResolvedValueOnce(run({ dispose }))
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(1))
    const parent = fakeAgent(fixture.ctx)

    const output = await runner.analyze(parent, [asset()], '  what is shown?  ', { x: 0, y: 0, width: 1, height: 1 }, new AbortController().signal)

    expect(fixture.resolveModelInfo).toHaveBeenCalledWith('zaizaizhao', 'gpt-5.6-luna', expect.any(AbortSignal))
    expect(fixture.start).toHaveBeenCalledOnce()
    const [provider, request] = fixture.start.mock.calls[0] as [string, SubagentStartRequest]
    expect(provider).toBe('spawn')
    expect(request).toMatchObject({
      label: 'Analyze visual evidence',
      parent,
      agentOptions: { provider: 'zaizaizhao', model: 'gpt-5.6-luna', maxTokens: 4096 },
      outputSchema: VISION_EVIDENCE_SCHEMA,
      maxDepth: 1,
      toolFilter: { allow: [] },
    })
    expect(request.persona).toContain('untrusted image content')
    expect(request.prompt).toHaveLength(2)
    expect(request.prompt[0]).toMatchObject({ type: 'text' })
    expect((request.prompt[0] as Extract<ContentBlock, { type: 'text' }>).text).toContain('x=0, y=0, width=1, height=1')
    expect(request.prompt[1]).toEqual({ type: 'image', attachment: asset().attachment })
    expect(output).toMatchObject({
      kind: 'foreground',
      childSessionId: 'child-1',
      evidence: {
        ...EVIDENCE,
        provider: 'zaizaizhao',
        model: 'gpt-5.6-luna',
        cached: false,
        warnings: [],
      },
    })
    expect(output.evidence.assets).toEqual([{
      assetId: 'vision:fixture', mediaType: 'image/png', bytes: asset().attachment.bytes, width: 1, height: 1,
    }])
    expect(Object.isFrozen(output)).toBe(true)
    expect(Object.isFrozen(output.evidence.observations[0])).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('uses completed and post-admission cache hits without starting another child', async () => {
    const first = deferred<SubagentResult>()
    const fixture = runtime(async () => run({ result: first.promise }))
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(1))
    const parent = fakeAgent(fixture.ctx)
    const signal = new AbortController().signal

    const pendingA = runner.analyze(parent, [asset()], 'what?', undefined, signal)
    await vi.waitFor(() => { expect(fixture.start).toHaveBeenCalledOnce() })
    const pendingB = runner.analyze(parent, [asset()], 'what?', undefined, signal)
    first.resolve(result())
    const [a, b] = await Promise.all([pendingA, pendingB])
    expect(a.evidence.cached).toBe(false)
    expect(b.evidence.cached).toBe(true)
    expect(fixture.start).toHaveBeenCalledOnce()

    const c = await runner.analyze(parent, [asset()], 'what?', undefined, signal)
    expect(c.evidence.cached).toBe(true)
    expect(fixture.resolveModelInfo).toHaveBeenCalledOnce()

    runner.clearCache()
    fixture.start.mockResolvedValueOnce(run({ id: 'child-2' }))
    const d = await runner.analyze(parent, [asset()], 'what?', undefined, signal)
    expect(d.childSessionId).toBe('child-2')
    expect(d.evidence.cached).toBe(false)
  })

  it('coalesces at parallel capacity without coupling subscriber cancellation', async () => {
    const child = deferred<SubagentResult>()
    const fixture = runtime(async () => run({ result: child.promise }))
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(2))
    const parent = fakeAgent(fixture.ctx)
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = runner.analyze(parent, [asset()], 'what?', undefined, firstController.signal)
    const second = runner.analyze(parent, [asset()], 'what?', undefined, secondController.signal)
    await vi.waitFor(() => { expect(fixture.start).toHaveBeenCalledOnce() })
    firstController.abort('first subscriber stopped')
    await expect(first).rejects.toMatchObject({ code: 'VISION_CANCELLED' })
    expect(secondController.signal.aborted).toBe(false)
    child.resolve(result())
    await expect(second).resolves.toMatchObject({ evidence: { cached: true } })
    expect(fixture.start).toHaveBeenCalledOnce()
  })

  it.each([
    [undefined],
    [['text'] as const],
    [['image'] as const],
  ])('rejects a route without explicit text-and-image capability (%j)', async (inputModalities) => {
    const fixture = runtime()
    fixture.resolveModelInfo.mockResolvedValueOnce({
      provider: 'zaizaizhao', id: 'gpt-5.6-luna', name: 'Luna', inputModalities,
    })
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(1))
    await expect(runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'what?', undefined, new AbortController().signal,
    )).rejects.toMatchObject({ code: 'VISION_MODEL_UNSUPPORTED' })
    expect(fixture.start).not.toHaveBeenCalled()
  })

  it('preserves a local provider failure code and bounded partial text', async () => {
    const fixture = runtime()
    const child = fakeAgent(fixture.ctx, 'child-failure')
    child.session.append('turn/start', { turn: 1 })
    child.session.append('turn/end', {
      turn: 1,
      reason: {
        kind: 'error',
        error: {
          message: 'Harness credential reference is unresolved',
          code: 'MISSING_CREDENTIAL',
          status: 401,
          providerRetryAfterMs: 25,
          requestId: ProviderRequestId('request-1'),
        },
      },
    })
    fixture.start.mockResolvedValueOnce(run({
      id: 'child-failure',
      localAgent: child,
      result: Promise.resolve(result({
        stopReason: 'error',
        structured: undefined,
        output: [
          { type: 'image', attachment: asset().attachment },
          { type: 'text', text: 'partial ' },
          { type: 'text', text: 'answer' },
        ],
      })),
    }))
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(1))

    const error = await runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'what?', undefined, new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(LlmError)
    expect(error).toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect((error as LlmError).failure).toMatchObject({
      code: 'MISSING_CREDENTIAL', status: 401, providerRetryAfterMs: 25, requestId: 'request-1',
    })
    expect((error as Error).message).toContain('Partial child text:\npartial answer')
  })

  it('preserves a minimal local provider failure without inventing optional facts', async () => {
    const fixture = runtime()
    const child = fakeAgent(fixture.ctx, 'minimal-failure')
    child.session.append('turn/start', { turn: 1 })
    child.session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'key missing', code: 'MISSING_CREDENTIAL' } },
    })
    fixture.start.mockResolvedValueOnce(run({
      id: 'minimal-failure',
      localAgent: child,
      result: Promise.resolve(result({ stopReason: 'error', structured: undefined, output: [] })),
    }))
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(1))
    const error = await runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'what?', undefined, new AbortController().signal,
    ).catch((reason: unknown) => reason as LlmError)
    expect((error as LlmError).failure).toEqual({ message: 'key missing', code: 'MISSING_CREDENTIAL' })
  })

  it.each([
    ['aborted', 'VISION_CANCELLED', 'cancelled'],
    ['error', 'VISION_STRUCTURE_INVALID', 'failed'],
    ['max-tokens', 'VISION_STRUCTURE_INVALID', 'output-token limit'],
    ['refusal', 'VISION_STRUCTURE_INVALID', 'refused'],
    ['future-stop', 'VISION_STRUCTURE_INVALID', 'future-stop'],
  ] as const)('maps %s without local failure to %s', async (stopReason, code, phrase) => {
    const fixture = runtime()
    fixture.start.mockResolvedValueOnce(run({ result: Promise.resolve(result({
      stopReason: stopReason as SubagentStopReason,
      structured: undefined,
      output: [{ type: 'text', text: 'partial output' }],
    })) }))
    const runner = new VisionRunner(fixture.ctx, config(), new VisionCapacity(1))
    const failure = await runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'what?', undefined, new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(failure).toMatchObject({ code })
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(phrase)
  })

  it('rejects malformed structured evidence and retains no-text and bounded-text diagnostics', async () => {
    const fixture = runtime()
    fixture.start
      .mockResolvedValueOnce(run({ result: Promise.resolve(result({ structured: { answer: 1 }, output: [] })) }))
      .mockResolvedValueOnce(run({ result: Promise.resolve(result({
        structured: null,
        output: [{ type: 'text', text: 'x'.repeat(20_000) }],
      })) }))
    const runner = new VisionRunner(fixture.ctx, config({ cacheMaxEntries: 1 }), new VisionCapacity(1))
    const first = await runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'first?', undefined, new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(first).toMatchObject({ code: 'VISION_STRUCTURE_INVALID' })
    expect(first).toBeInstanceOf(Error)
    expect((first as Error).message).not.toContain('Partial child text')
    const second = await runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'second?', undefined, new AbortController().signal,
    ).catch((reason: unknown) => reason as Error)
    expect((second as Error).message).toContain('Partial child text:\n')
    expect((second as Error).message).not.toContain('x'.repeat(16_385))
  })

  it('does not let disposal hide success or replace a primary execution failure', async () => {
    const execution = new Error('execution failed')
    const disposal = new Error('disposal failed')
    const nonErrorExecution = deferred<SubagentResult>()
    const fixture = runtime()
    fixture.start
      .mockResolvedValueOnce(run({ dispose: async () => { throw disposal } }))
      .mockResolvedValueOnce(run({
        result: Promise.resolve().then(() => { throw execution }),
        dispose: async () => { throw disposal },
      }))
      .mockResolvedValueOnce(run({ result: nonErrorExecution.promise }))
    const runner = new VisionRunner(fixture.ctx, config({ cacheMaxEntries: 1 }), new VisionCapacity(1))
    await expect(runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'success then dispose?', undefined, new AbortController().signal,
    )).rejects.toBe(disposal)
    const aggregate = await runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'both fail?', undefined, new AbortController().signal,
    ).catch((reason: unknown) => reason)
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect((aggregate as AggregateError).errors).toEqual([execution, disposal])
    const wrappedPromise = runner.analyze(
      fakeAgent(fixture.ctx), [asset()], 'non-error fail?', undefined, new AbortController().signal,
    )
    nonErrorExecution.reject('non-error execution failure')
    const wrapped = await wrappedPromise.catch((reason: unknown) => reason)
    expect(wrapped).toMatchObject({
      message: 'Luna visual child failed',
      cause: 'non-error execution failure',
    })
  })

  it('maps deadline and caller cancellation but never rewrites an LLM error', async () => {
    const preAbortedRuntime = runtime()
    const preAbortedRunner = new VisionRunner(preAbortedRuntime.ctx, config(), new VisionCapacity(1))
    const preAbortedController = new AbortController()
    preAbortedController.abort('already stopped')
    await expect(preAbortedRunner.analyze(
      fakeAgent(preAbortedRuntime.ctx), [asset()], 'what?', undefined, preAbortedController.signal,
    )).rejects.toMatchObject({ code: 'VISION_CANCELLED' })
    expect(preAbortedRuntime.resolveModelInfo).not.toHaveBeenCalled()
    expect(preAbortedRuntime.start).not.toHaveBeenCalled()

    vi.useFakeTimers()
    const timedRuntime = runtime(async request => run({
      result: new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new Error('child aborted', { cause: request.signal.reason }))
        }, { once: true })
      }),
    }))
    const timedRunner = new VisionRunner(
      timedRuntime.ctx, config({ visionTimeoutMs: 10 }), new VisionCapacity(1),
    )
    const timed = timedRunner.analyze(
      fakeAgent(timedRuntime.ctx), [asset()], 'what?', undefined, new AbortController().signal,
    )
    const timedResult = expect(timed).rejects.toMatchObject({ code: 'VISION_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(11)
    await timedResult
    vi.useRealTimers()

    const cancelledRuntime = runtime(async request => run({
      result: new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new Error('child aborted', { cause: request.signal.reason }))
        }, { once: true })
      }),
    }))
    const cancelledRunner = new VisionRunner(cancelledRuntime.ctx, config(), new VisionCapacity(1))
    const controller = new AbortController()
    const cancelled = cancelledRunner.analyze(
      fakeAgent(cancelledRuntime.ctx), [asset()], 'what?', undefined, controller.signal,
    )
    await vi.waitFor(() => { expect(cancelledRuntime.start).toHaveBeenCalledOnce() })
    controller.abort('caller stopped')
    await expect(cancelled).rejects.toMatchObject({ code: 'VISION_CANCELLED' })

    const llmError = new LlmError('credential missing', 'MISSING_CREDENTIAL')
    const llmController = new AbortController()
    const llmRuntime = runtime(async (request) => {
      llmController.abort('cancelled while child failed')
      return run({ result: Promise.reject(llmError), dispose: async () => {
        expect(request.signal.aborted).toBe(true)
      } })
    })
    const llmRunner = new VisionRunner(llmRuntime.ctx, config(), new VisionCapacity(1))
    await expect(llmRunner.analyze(
      fakeAgent(llmRuntime.ctx), [asset()], 'what?', undefined, llmController.signal,
    )).rejects.toBe(llmError)
  })
})
