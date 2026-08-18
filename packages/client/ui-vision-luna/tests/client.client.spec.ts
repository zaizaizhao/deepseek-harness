// @vitest-environment jsdom

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationImageIntake,
  ConversationImageIntakeRequest,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VisionAssetId } from '@deepseek-ai/dsh-tool-vision-luna/types'
import type { VisionUploadRequest } from '@deepseek-ai/dsh-tool-vision-luna/types'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { VisionImageLoader } from '../src/client/presentation.tsx'
import type { ReactElement } from 'react'

const imageAttachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 1,
  width: 1,
  height: 1,
  name: 'screen.png',
}
const imageAuthorization = {
  assetId: VisionAssetId(`vision:${imageAttachment.attachmentId}`),
  attachment: imageAttachment,
  source: { kind: 'upload' as const, name: 'screen.png' },
}

const request = (
  files: readonly File[],
  signal = new AbortController().signal,
): ConversationImageIntakeRequest => ({ sessionId: 'session-1' as SessionId, files, signal })

function success(count: number) {
  return {
    ok: true as const,
    value: {
      toolName: 'gpt_luna_vision',
      assets: Array.from({ length: count }, (_, index) => ({
        assetId: VisionAssetId(`vision:asset-${index + 1}`),
        mediaType: 'image/png' as const,
        bytes: index + 1,
        width: 1,
        height: 1,
      })),
    },
  }
}

type UploadResponse = ReturnType<typeof success> | {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string; readonly details: object }
}

type ReadResponse = {
  readonly ok: true
  readonly value: string
} | {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string; readonly details: object }
}

function bench(options: {
  mountFailure?: Error
  registerFailure?: Error
  omitNamespace?: boolean
} = {}) {
  const ctx = new Context()
  const upload = vi.fn((_sessionId: SessionId, _request: VisionUploadRequest, _signal: AbortSignal) =>
    Promise.resolve<UploadResponse>(success(1)))
  const read = vi.fn((
    _sessionId: SessionId,
    _assetId: string,
    _signal: AbortSignal,
  ) => Promise.resolve<ReadResponse>({
    ok: true as const,
    value: 'AA==',
  }))
  const order: string[] = []
  const disposeRemote = vi.fn(async () => { order.push('remote') })
  const mount = vi.fn()

  class RemoteFixture extends Service {
    constructor(private readonly owner: Context) {
      super(owner, 'remote')
    }

    async $mount(): Promise<() => Promise<void>> {
      mount()
      if (options.mountFailure !== undefined) throw options.mountFailure
      const namespace = this.owner.plugin((scope) => {
        if (options.omitNamespace !== true) scope.provide('remote.visionLuna', { upload, read })
      })
      await namespace
      return async () => {
        await namespace.dispose()
        await disposeRemote()
      }
    }
  }

  new RemoteFixture(ctx)
  const registerDefinition = vi.fn(() => () => {})
  ctx.provide('conversationEvents', {
    register: registerDefinition,
  } as unknown as Context['conversationEvents'])
  const registerRenderer = vi.fn((_options: unknown, _component: unknown) => () => {})
  const injectSlot = vi.fn((_key: string, setup: () => Iterable<() => void>) => {
    const disposers = [...setup()]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  })
  ctx.provide('slots', {
    inject: injectSlot,
    register: registerRenderer,
  } as unknown as Context['slots'])
  let adapter: ConversationImageIntake | undefined
  const disposeIntake = vi.fn(async () => { order.push('intake') })
  ctx.provide('conversation', {
    registerImageIntake(candidate: ConversationImageIntake) {
      if (options.registerFailure !== undefined) throw options.registerFailure
      adapter = candidate
      return disposeIntake
    },
  } as unknown as Context['conversation'])
  return {
    ctx, upload, read, mount, disposeRemote, disposeIntake, order,
    registerDefinition, registerRenderer, injectSlot,
    adapter: () => {
      if (adapter === undefined) throw new Error('image intake adapter was not registered')
      return adapter
    },
  }
}

async function mountPlugin(b: ReturnType<typeof bench>) {
  const fiber = b.ctx.plugin({ inject, apply })
  await fiber
  return fiber
}

describe('ui-vision-luna client plugin', () => {
  it('declares the services used for Remote mounting and durable Chat presentation', () => {
    expect(inject).toEqual(['remote', 'conversationEvents', 'slots'])
  })

  it('keeps text-only submissions sendable by treating an empty image batch as a no-op', async () => {
    const b = bench()
    const fiber = await mountPlugin(b)

    await expect(b.adapter().prepare(request([]))).resolves.toEqual([])
    expect(b.upload).not.toHaveBeenCalled()
    expect(b.registerDefinition).toHaveBeenCalledOnce()
    expect(b.registerRenderer.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ key: 'user', priority: -10 }),
      expect.objectContaining({ key: 'steering', priority: -10 }),
    ])
    await fiber.dispose()
  })

  it('uploads through the explicitly injected namespace with the target Session id', async () => {
    const b = bench()
    const fiber = await mountPlugin(b)
    const large = new Uint8Array(0x8001)
    large[0] = 1
    large[large.length - 1] = 2
    b.upload.mockResolvedValueOnce(success(2))
    const signal = new AbortController().signal
    const parts = await b.adapter().prepare(request([
      new File([large], 'large.png', { type: 'image/png' }),
      new File([Uint8Array.of(3)], '', { type: 'image/jpeg' }),
    ], signal))

    expect(b.mount).toHaveBeenCalledOnce()
    const firstCall = b.upload.mock.calls[0]
    if (firstCall === undefined) throw new Error('vision upload was not called')
    expect(firstCall[0]).toBe('session-1')
    expect(firstCall[2]).toBe(signal)
    expect(firstCall[1].images[0]).toMatchObject({ mediaType: 'image/png', name: 'large.png' })
    expect(firstCall[1].images[1]).toEqual({ data: 'Aw==', mediaType: 'image/jpeg' })
    const encoded = firstCall[1].images[0]?.data
    expect(typeof encoded).toBe('string')
    expect(atob(encoded ?? '').length).toBe(large.length)
    expect(parts).toEqual([
      { type: 'text', text: 'Visual asset available through gpt_luna_vision: asset_id=vision:asset-1.' },
      { type: 'text', text: 'Visual asset available through gpt_luna_vision: asset_id=vision:asset-2.' },
    ])
    expect(JSON.stringify(parts)).not.toContain('base64')
    await fiber.dispose()
    expect(b.order).toEqual(['intake', 'remote'])
  })

  it('loads sent visual assets through the plugin Remote and cancels the loader on unload', async () => {
    const b = bench()
    const fiber = await mountPlugin(b)
    const registered: unknown = b.registerRenderer.mock.calls[0]?.[1]
    if (typeof registered !== 'function') throw new Error('user renderer was not registered')
    const Renderer = registered as (props: object) => ReactElement<{ loadVisionImage: VisionImageLoader }>
    const element = Renderer({})

    await expect(element.props.loadVisionImage(
      'session-1' as SessionId,
      imageAuthorization,
    )).resolves.toBe('data:image/png;base64,AA==')
    expect(b.read).toHaveBeenCalledWith(
      'session-1',
      String(imageAuthorization.assetId),
      expect.any(AbortSignal),
    )
    const remoteSignal = b.read.mock.calls[0]?.[2]
    expect(remoteSignal?.aborted).toBe(false)

    b.read.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VISION_ASSET_FORBIDDEN', message: 'not authorized', details: {} },
    })
    await expect(element.props.loadVisionImage(
      'session-1' as SessionId,
      imageAuthorization,
    )).rejects.toThrow('VISION_ASSET_FORBIDDEN: not authorized')

    await fiber.dispose()
    expect(remoteSignal?.aborted).toBe(true)
    await expect(element.props.loadVisionImage(
      'session-1' as SessionId,
      imageAuthorization,
    )).rejects.toThrow('presentation was cancelled')
  })

  it('rejects cancellation, unsupported MIME, Remote failure, and receipt mismatch', async () => {
    const cancelled = bench()
    await mountPlugin(cancelled)
    const controller = new AbortController()
    controller.abort('cancelled-before-upload')
    await expect(cancelled.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.png', { type: 'image/png' }),
    ], controller.signal))).rejects.toMatchObject({ cause: 'cancelled-before-upload' })

    const midRead = bench()
    await mountPlugin(midRead)
    const midReadController = new AbortController()
    const abortingFile = new File([Uint8Array.of(1)], 'x.png', { type: 'image/png' })
    Object.defineProperty(abortingFile, 'arrayBuffer', {
      value: async () => {
        midReadController.abort('cancelled-after-read')
        return Uint8Array.of(1).buffer
      },
    })
    await expect(midRead.adapter().prepare(request([
      abortingFile,
      new File([Uint8Array.of(2)], 'never-read.png', { type: 'image/png' }),
    ], midReadController.signal)))
      .rejects.toMatchObject({ cause: 'cancelled-after-read' })

    const invalid = bench()
    await mountPlugin(invalid)
    await expect(invalid.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.svg', { type: 'image/svg+xml' }),
    ]))).rejects.toThrow('unsupported browser image type')

    const failed = bench()
    await mountPlugin(failed)
    failed.upload.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VISION_INVALID_ASSET', message: 'bad bytes', details: {} },
    })
    await expect(failed.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.webp', { type: 'image/webp' }),
    ]))).rejects.toThrow('VISION_INVALID_ASSET: bad bytes')

    const mismatch = bench()
    await mountPlugin(mismatch)
    mismatch.upload.mockResolvedValueOnce(success(0))
    await expect(mismatch.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.gif', { type: 'image/gif' }),
    ]))).rejects.toThrow('returned 0 assets for 1 files')
  })

  it('does not register after a Remote mount failure and unwinds Remote when registration fails', async () => {
    const mountError = new Error('mount failed')
    const mountFailed = bench({ mountFailure: mountError })
    await expect(mountPlugin(mountFailed)).rejects.toBe(mountError)
    expect(mountFailed.disposeRemote).not.toHaveBeenCalled()

    const missingNamespace = bench({ omitNamespace: true })
    await expect(mountPlugin(missingNamespace)).rejects.toThrow('did not mount its namespace')
    expect(missingNamespace.disposeRemote).toHaveBeenCalledOnce()

    const registerError = new Error('duplicate adapter')
    const registerFailed = bench({ registerFailure: registerError })
    await expect(mountPlugin(registerFailed)).rejects.toBe(registerError)
    expect(registerFailed.disposeRemote).toHaveBeenCalledOnce()
  })
})
