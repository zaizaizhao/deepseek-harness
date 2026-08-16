// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationImageIntake,
  ConversationImageIntakeRequest,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VisionAssetId } from '@deepseek-ai/dsh-tool-vision-luna/types'
import type { VisionUploadRequest } from '@deepseek-ai/dsh-tool-vision-luna/types'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

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

function bench(options: {
  scope?: boolean
  mountFailure?: Error
  registerFailure?: Error
} = {}) {
  const ctx = new Context()
  const scoped = ctx.plugin(() => {}).ctx
  const upload = vi.fn((_request: VisionUploadRequest, _signal: AbortSignal) =>
    Promise.resolve<UploadResponse>(success(1)))
  const order: string[] = []
  const disposeRemote = vi.fn(async () => { order.push('remote') })
  const mountFailure = options.mountFailure
  const mount = mountFailure === undefined
    ? vi.fn(() => Promise.resolve(disposeRemote))
    : vi.fn(() => Promise.reject(mountFailure))
  const remote = { $mount: mount, visionLuna: { upload } }
  ctx.provide('remote', remote as unknown as Context['remote'])
  ctx.provide('sessions', {
    scope: () => options.scope === false ? undefined : scoped,
  } as unknown as Context['sessions'])
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
    ctx, scoped, upload, mount, disposeRemote, disposeIntake, order,
    adapter: () => {
      if (adapter === undefined) throw new Error('image intake adapter was not registered')
      return adapter
    },
  }
}

describe('ui-vision-luna client plugin', () => {
  it('declares the three services it consumes', () => {
    expect(inject).toEqual(['sessions', 'remote', 'conversation'])
  })

  it('uploads one atomic browser batch and returns only stable text references', async () => {
    const b = bench()
    const dispose = await apply(b.ctx)
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
    expect(firstCall[1]).toBe(signal)
    expect(firstCall[0].images[0]).toMatchObject({ mediaType: 'image/png', name: 'large.png' })
    expect(firstCall[0].images[1]).toEqual({ data: 'Aw==', mediaType: 'image/jpeg' })
    const encoded = firstCall[0].images[0]?.data
    expect(typeof encoded).toBe('string')
    expect(atob(encoded ?? '').length).toBe(large.length)
    expect(parts).toEqual([
      { type: 'text', text: 'Visual asset available through gpt_luna_vision: asset_id=vision:asset-1.' },
      { type: 'text', text: 'Visual asset available through gpt_luna_vision: asset_id=vision:asset-2.' },
    ])
    expect(JSON.stringify(parts)).not.toContain('base64')
    await dispose()
    expect(b.order).toEqual(['intake', 'remote'])
  })

  it('rejects cancellation, missing scope, unsupported MIME, Remote failure, and receipt mismatch', async () => {
    const cancelled = bench()
    await apply(cancelled.ctx)
    const controller = new AbortController()
    controller.abort('cancelled-before-upload')
    await expect(cancelled.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.png', { type: 'image/png' }),
    ], controller.signal))).rejects.toMatchObject({ cause: 'cancelled-before-upload' })

    const midRead = bench()
    await apply(midRead.ctx)
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

    const missing = bench({ scope: false })
    await apply(missing.ctx)
    await expect(missing.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.png', { type: 'image/png' }),
    ]))).rejects.toThrow('requires a live Client Session scope')

    const invalid = bench()
    await apply(invalid.ctx)
    await expect(invalid.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.svg', { type: 'image/svg+xml' }),
    ]))).rejects.toThrow('unsupported browser image type')

    const failed = bench()
    await apply(failed.ctx)
    failed.upload.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VISION_INVALID_ASSET', message: 'bad bytes', details: {} },
    })
    await expect(failed.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.webp', { type: 'image/webp' }),
    ]))).rejects.toThrow('VISION_INVALID_ASSET: bad bytes')

    const mismatch = bench()
    await apply(mismatch.ctx)
    mismatch.upload.mockResolvedValueOnce(success(0))
    await expect(mismatch.adapter().prepare(request([
      new File([Uint8Array.of(1)], 'x.gif', { type: 'image/gif' }),
    ]))).rejects.toThrow('returned 0 assets for 1 files')
  })

  it('does not register after a Remote mount failure and unwinds Remote when registration fails', async () => {
    const mountError = new Error('mount failed')
    const mountFailed = bench({ mountFailure: mountError })
    await expect(apply(mountFailed.ctx)).rejects.toBe(mountError)
    expect(mountFailed.disposeRemote).not.toHaveBeenCalled()

    const registerError = new Error('duplicate adapter')
    const registerFailed = bench({ registerFailure: registerError })
    await expect(apply(registerFailed.ctx)).rejects.toBe(registerError)
    expect(registerFailed.disposeRemote).toHaveBeenCalledOnce()
  })
})
