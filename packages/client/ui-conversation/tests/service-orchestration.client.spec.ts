// @vitest-environment jsdom
// ConversationController scope addressing over the runtime's real scope tag:
// TestSessions mints tagged scopes through the production createScope, so the
// service's scopeOf/binding path runs against production resolution (no local
// tag probe).
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { QueuedMessage, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'
import { InputHub } from '../src/client/input/hub.ts'
import { ConversationController, UnsupportedImageMediaTypeError } from '../src/client/service.ts'
import type { ConversationImageIntake } from '../src/client/service.ts'
import { zh } from '../src/client/locales.ts'

async function bench(readAttachment?: SessionFace['readAttachment']) {
  const runtime = await SlotTestRuntime.create()
  const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const updateQueue = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const cancel = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  const loadOlder = vi.fn(() => Promise.resolve())
  await runtime.sessions.add({
    id: 's1',
    session: { prompt, updateQueue, cancel, loadOlder, ...(readAttachment === undefined ? {} : { readAttachment }) },
  })
  // config.input is required (the apply shares its hub with the inject
  // factories); the bench passes its own instance explicitly.
  const hub = new InputHub(runtime.ctx, makeTranslate(zh, {}))
  const fiber = runtime.ctx.plugin(ConversationController, {
    input: hub,
    blocks: new ComposerBlockRegistry(),
  })
  await fiber.await()
  const root = runtime.ctx.get('conversation') as ConversationController
  const scoped = runtime.sessions.scope('s1')!.get('conversation') as ConversationController
  const session = runtime.sessions.behavior('s1')
  const shell = hub.shellFor(runtime.sessions.binding('s1')!)
  return { runtime, fiber, root, scoped, session, hub, shell, prompt, updateQueue, cancel, loadOlder }
}

function mountImageIntake(ctx: Context, adapter: ConversationImageIntake) {
  return ctx.plugin({
    inject: ['conversation'],
    apply(pluginCtx: Context): void {
      pluginCtx.conversation.registerImageIntake(adapter)
    },
  })
}

describe('ConversationController', () => {
  it('routes operations through the public Session binding', async () => {
    const b = await bench()
    await b.scoped.send('hello')
    await b.scoped.updateQueue('item-1' as never, { kind: 'remove' })
    await b.scoped.cancel()
    await b.scoped.loadOlder()
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue')
    expect(b.updateQueue).toHaveBeenCalledWith('item-1', { kind: 'remove' })
    expect(b.cancel).toHaveBeenCalledOnce()
    expect(b.loadOlder).toHaveBeenCalledOnce()
    await b.runtime.dispose()
  })

  it('folds Session business failures into callback rejections', async () => {
    const b = await bench()
    b.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'busy', details: {} } } as never)
    await expect(b.scoped.send('x')).rejects.toThrow('conversation.send failed: agent-busy: busy')
    b.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'nope', details: {} } } as never)
    await expect(b.scoped.cancel()).rejects.toThrow('conversation.cancel failed: internal: nope')
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'broken', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-1' as never, { kind: 'steer' }))
      .rejects.toThrow('conversation.updateQueue failed: internal: broken')
    await b.runtime.dispose()
  })

  it('treats strict-steer races as converged Queue delivery', async () => {
    const b = await bench()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'steer-unavailable', message: 'closed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-1' as never, { kind: 'steer' })).resolves.toBeUndefined()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-2' as never, { kind: 'steer' })).resolves.toBeUndefined()
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    await expect(b.scoped.updateQueue('item-3' as never, { kind: 'remove' }))
      .rejects.toThrow('conversation.updateQueue failed: queue-item-not-found: claimed')
    await b.runtime.dispose()
  })

  it('releases draft previews when their session scope is disposed', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:draft-1')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      const [attachment] = b.root.createDraftImages([
        new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }),
      ])
      if (attachment === undefined) throw new Error('draft attachment missing')
      b.root.input.for(b.runtime.sessions.scope('s1')!).addImages([attachment.id])
      await b.runtime.sessions.remove('s1')
      expect(b.root.draftImages([attachment.id])).toEqual([])
      expect(revoked).toHaveBeenCalledWith('blob:draft-1')
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('validates every MIME type before allocating previews', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    expect(() => b.root.createDraftImages([
      new File([Uint8Array.of(1)], 'valid.png', { type: 'image/png' }),
      new File([Uint8Array.of(2)], 'invalid.svg', { type: 'image/svg+xml' }),
    ])).toThrow(UnsupportedImageMediaTypeError)
    expect(created).not.toHaveBeenCalled()
    created.mockRestore()
    await b.runtime.dispose()
  })

  it('keeps native raw-image serialization when no intake plugin is mounted', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:native')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    try {
      const [attachment] = b.root.createDraftImages([
        new File([Uint8Array.of(1, 2, 3)], 'native.png', { type: 'image/png' }),
      ])
      if (attachment === undefined) throw new Error('draft attachment missing')
      await b.root.sendSession(b.session, 'inspect', [attachment.id], 'queue')
      expect(b.prompt).toHaveBeenCalledWith([
        { type: 'image', mediaType: 'image/png', data: 'AQID', name: 'native.png' },
        { type: 'text', text: 'inspect' },
      ], 'queue')
      expect(b.root.draftImages([attachment.id])).toEqual([])
      expect(revoked).toHaveBeenCalledWith('blob:native')
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('lets one intake plugin replace image bytes with text-only references', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:governed')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const prepare = vi.fn<ConversationImageIntake['prepare']>(() => Promise.resolve([
      { type: 'text', text: 'asset_id=vision:sha256' },
    ]))
    const intake = mountImageIntake(b.runtime.ctx, { prepare })
    await intake.await()
    try {
      const [attachment] = b.root.createDraftImages([
        new File([Uint8Array.of(4, 5)], 'governed.png', { type: 'image/png' }),
      ])
      if (attachment === undefined) throw new Error('draft attachment missing')
      await b.root.sendSession(b.session, 'what is shown?', [attachment.id], 'steer')
      expect(prepare).toHaveBeenCalledOnce()
      expect(prepare.mock.calls[0]?.[0]).toMatchObject({
        sessionId: b.session.sessionId,
        files: [expect.objectContaining({ name: 'governed.png', type: 'image/png' })],
      })
      expect(b.prompt).toHaveBeenCalledWith([
        { type: 'text', text: 'asset_id=vision:sha256' },
        { type: 'text', text: 'what is shown?' },
      ], 'steer')
    } finally {
      await intake.dispose()
      created.mockRestore()
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('fails loud on duplicate intake providers and restores native behavior after unload', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hmr')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const first = mountImageIntake(b.runtime.ctx, {
      prepare: () => Promise.resolve([{ type: 'text', text: 'asset_id=first' }]),
    })
    await first.await()
    const duplicate = mountImageIntake(b.runtime.ctx, {
      prepare: () => Promise.resolve([{ type: 'text', text: 'asset_id=second' }]),
    })
    await expect(duplicate).rejects.toThrow('already registered')
    await first.dispose()
    try {
      const [attachment] = b.root.createDraftImages([
        new File([Uint8Array.of(9)], '', { type: 'image/gif' }),
      ])
      if (attachment === undefined) throw new Error('draft attachment missing')
      await b.root.sendSession(b.session, '', [attachment.id], 'queue')
      expect(b.prompt).toHaveBeenCalledWith([
        { type: 'image', mediaType: 'image/gif', data: 'CQ==' },
      ], 'queue')
    } finally {
      created.mockRestore()
      revoked.mockRestore()
    }
    await b.runtime.dispose()
  })

  it('aborts an in-flight intake on plugin unload and retains drafts after prompt failure', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const pending = Promise.withResolvers<readonly [{ readonly type: 'text'; readonly text: string }]>()
    let signal: AbortSignal | undefined
    const intake = mountImageIntake(b.runtime.ctx, {
      prepare: (request) => {
        signal = request.signal
        return pending.promise
      },
    })
    await intake.await()
    const [attachment] = b.root.createDraftImages([
      new File([Uint8Array.of(7)], 'pending.webp', { type: 'image/webp' }),
    ])
    if (attachment === undefined) throw new Error('draft attachment missing')
    const sending = b.root.sendSession(b.session, 'pending', [attachment.id], 'queue')
    await vi.waitFor(() => { expect(signal).toBeDefined() })
    await intake.dispose()
    expect(signal?.aborted).toBe(true)
    pending.resolve([{ type: 'text', text: 'asset_id=too-late' }])
    await expect(sending).rejects.toBe('conversation image intake adapter unloaded')
    expect(b.prompt).not.toHaveBeenCalled()
    expect(b.root.draftImages([attachment.id])).toHaveLength(1)

    const failing = mountImageIntake(b.runtime.ctx, {
      prepare: () => Promise.resolve([{ type: 'text', text: 'asset_id=retained' }]),
    })
    await failing.await()
    b.prompt.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'down', details: {} },
    } as never)
    await expect(b.root.sendSession(b.session, 'retry', [attachment.id], 'queue'))
      .rejects.toThrow('conversation.send failed: internal: down')
    expect(b.root.draftImages([attachment.id])).toHaveLength(1)
    await failing.dispose()
    created.mockRestore()
    revoked.mockRestore()
    await b.runtime.dispose()
  })

  it('invalidates pending historical image loads when the rendered session is released', async () => {
    const read = Promise.withResolvers<Awaited<ReturnType<SessionFace['readAttachment']>>>()
    const b = await bench(() => read.promise)
    const sessionId = b.runtime.sessions.behavior('s1').sessionId
    const attachment = {
      attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
    } as const
    const pending = b.root.resolveImage(sessionId, attachment)
    b.root.releaseSessionImages(sessionId)
    read.resolve({ ok: true, value: { attachment, data: Uint8Array.of(1) } })
    await expect(pending).rejects.toThrow('historical image scope was released')
    await b.runtime.dispose()
  })

  it('fails loudly from the root scope, on an unbound session, or without SessionRuntime', async () => {
    const b = await bench()
    await expect(b.root.send('x')).rejects.toThrow(/requires a session scope/)
    await b.runtime.sessions.remove('s1')
    await expect(b.scoped.send('x')).rejects.toThrow(/resolved no binding/)
    await b.runtime.dispose()
    // No SessionRuntime at all: a bare context (the runtime always provides one).
    const bare = new Context()
    await bare.plugin(ConversationController, {
      input: new InputHub(bare, makeTranslate(zh, {})),
      blocks: new ComposerBlockRegistry(),
    }).await()
    const orphan = bare.get('conversation') as ConversationController
    await expect(orphan.send('x')).rejects.toThrow(/sessions service unavailable/)
  })
})

describe('InputHub queue steering (empty-draft accelerated Enter)', () => {
  const row = (id: string): QueuedMessage => ({
    id: id as never,
    messageId: `message-${id}` as never,
    placement: 'queued',
    content: [{ type: 'text', text: id }],
    preview: id,
    text: id,
  })

  it('steers every queued row in FIFO order and leaves steering rows alone', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), { ...row('q-2'), placement: 'steering' }, row('q-3')]
    })
    b.shell.steerQueue()
    await vi.waitFor(() => {
      expect(b.updateQueue).toHaveBeenCalledTimes(2)
    })
    expect(b.updateQueue).toHaveBeenNthCalledWith(1, 'q-1', { kind: 'steer' })
    expect(b.updateQueue).toHaveBeenNthCalledWith(2, 'q-3', { kind: 'steer' })
    expect(b.shell.notices.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('converges silently when the turn closes or a row is claimed mid-steer', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), row('q-2')]
    })
    // The turn closes before the second row: the flush stops, silently.
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'steer-unavailable', message: 'closed', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => { expect(b.updateQueue).toHaveBeenCalledTimes(1) })
    expect(b.shell.notices.getSnapshot()).toBeNull()

    // A row the host already claimed (e.g. a repeated empty-draft chord):
    // the duplicate strict steer is a silent no-op.
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-3')]
    })
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'queue-item-not-found', message: 'claimed', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => { expect(b.updateQueue).toHaveBeenCalledTimes(2) })
    expect(b.shell.notices.getSnapshot()).toBeNull()
    await b.runtime.dispose()
  })

  it('surfaces one notice on a genuine steer failure and stops', async () => {
    const b = await bench()
    await b.runtime.sessions.updateSnapshot('s1', (draft) => {
      draft.queue = [row('q-1'), row('q-2')]
    })
    b.updateQueue.mockResolvedValueOnce({
      ok: false, error: { code: 'internal', message: 'broken', details: {} },
    } as never)
    b.shell.steerQueue()
    await vi.waitFor(() => {
      expect(b.shell.notices.getSnapshot()).toEqual(
        expect.objectContaining({ level: 'error', text: '插话发送失败，请重试。' }),
      )
    })
    expect(b.updateQueue).toHaveBeenCalledTimes(1)
    await b.runtime.dispose()
  })

  it('no-ops without queued rows', async () => {
    const b = await bench()
    b.shell.steerQueue()
    expect(b.updateQueue).not.toHaveBeenCalled()
    await b.runtime.dispose()
  })
})
