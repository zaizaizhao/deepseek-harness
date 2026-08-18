// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  conversationContextKey,
  type ChatConversationViewNode,
  type ConversationSnapshot,
  type UseConversationSession,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VisionAssetId } from '@deepseek-ai/dsh-tool-vision-luna/types'
import {
  type VisionImageLoader,
  VisionUserMessageNodeView,
  visionAssetDefinition,
} from '../src/client/presentation.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const assetId = `vision:sha256:${'a'.repeat(64)}` as VisionAssetId
const reference = `Visual asset available through gpt_luna_vision: asset_id=${assetId}.`
const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'screen.png',
}
const authorization = {
  assetId,
  attachment,
  source: { kind: 'upload' as const, name: 'screen.png' },
}
const nativeAttachment = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
  mediaType: 'image/jpeg' as const,
  bytes: 69,
  width: 320,
  height: 640,
  name: 'native.jpg',
}

const translations: Record<string, string> = {
  copied: '已复制',
  copy: '复制',
  'clock.md': '08-17',
  'clock.ymd': '2026-08-17',
  'image.closePreview': '关闭原图预览',
  'image.label': '图片',
  'image.loadFailed': '图片加载失败，点击重试',
  'image.loading': '图片加载中…',
  'image.openOriginal': '查看原图',
  'image.openOriginalLabel': 'screen.png，点击查看原图',
  'image.preview': '原图预览',
  'json.truncated': '已截断',
  'message.extraBlock': '额外内容块',
}

function t(key: string): string {
  return translations[key] ?? key
}

type VisionUserTestProps = ChatNodeViewProps<'user'> & {
  readonly loadVisionImage: VisionImageLoader
}

function props(options: {
  content: readonly unknown[]
  authorized?: boolean
  assetNode?: ChatConversationViewNode
  time?: number
  probeEquality?: boolean
  loadImage?: ReturnType<typeof vi.fn>
  loadVisionImage?: ReturnType<typeof vi.fn>
}): VisionUserTestProps {
  const defaultAssetNode = {
    key: 'asset-node',
    kind: 'vision-luna-asset',
    id: assetId,
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'session' },
    visibility: 'hidden',
    data: { authorization },
  } as ChatConversationViewNode
  const snapshot = {
    chat: {
      nodes: {
        get: () => options.authorized === false ? undefined : options.assetNode ?? defaultAssetNode,
      },
    },
  } as unknown as ConversationSnapshot
  const useSession: UseConversationSession = (selector, equality) => {
    const selected = selector(snapshot)
    if (options.probeEquality === true && equality !== undefined) {
      type Selection = readonly (ChatConversationViewNode | undefined)[]
      const compare = equality as unknown as (left: Selection, right: Selection) => boolean
      expect(compare([], [])).toBe(true)
      expect(compare([defaultAssetNode], [])).toBe(false)
      expect(compare([defaultAssetNode], [undefined])).toBe(false)
      expect(compare([defaultAssetNode], [defaultAssetNode])).toBe(true)
    }
    return selected
  }
  return {
    node: {
      key: 'user-node',
      kind: 'user',
      id: 'message-1',
      target: 'chat',
      anchorSeq: 2,
      location: { kind: 'session' },
      visibility: 'visible',
      data: {
        kind: 'user',
        seq: 2,
        time: options.time ?? new Date(2026, 7, 17, 12, 34).getTime(),
        content: options.content,
        source: { kind: 'user' },
      },
    },
    sessionId: 'session-1',
    useSession,
    loadImage: options.loadImage ?? vi.fn().mockResolvedValue('blob:screen'),
    loadVisionImage: options.loadVisionImage ?? vi.fn().mockResolvedValue('blob:vision-screen'),
    t,
  } as unknown as VisionUserTestProps
}

describe('visionAssetDefinition', () => {
  const event = {
    seq: 7,
    type: 'vision/asset',
    data: {
      assetId,
      attachment,
      source: { kind: 'upload', name: 'screen.png' },
    },
  }

  it('projects a durable authorization event as one hidden direct-key Chat node', () => {
    const match = visionAssetDefinition.match(event as never)
    expect(match).toEqual({ id: assetId, role: 'start' })
    expect(visionAssetDefinition.match({ ...event, type: 'user/message' } as never)).toBeNull()
    if (match === null) throw new Error('vision asset event did not match')

    const state = visionAssetDefinition.start({} as never, { event, match } as never, {} as never)
    expect(state).toEqual({ authorization })
    expect(visionAssetDefinition.update({ state } as never, {} as never)).toBe(state)
    if (visionAssetDefinition.buildViewNode === undefined) {
      throw new Error('vision asset Definition has no Chat projection')
    }
    expect(visionAssetDefinition.buildViewNode({ state: undefined } as never)).toBeNull()
    expect(visionAssetDefinition.buildViewNode({ state, start: undefined } as never)).toBeNull()
    expect(visionAssetDefinition.buildViewNode({
      key: conversationContextKey('vision-luna-asset', assetId),
      id: assetId,
      state,
      start: { event, location: { kind: 'session' } },
    } as never)).toEqual(expect.objectContaining({
      kind: 'vision-luna-asset',
      id: assetId,
      anchorSeq: 7,
      visibility: 'hidden',
      data: state,
    }))
  })

  it('rejects a forged non-asset start match', () => {
    expect(() => visionAssetDefinition.start(
      {} as never,
      { event: { ...event, type: 'user/message' } } as never,
      {} as never,
    )).toThrow('start requires vision/asset')
  })
})

describe('VisionUserMessageNodeView', () => {
  it('projects an authorized model reference as a durable image and keeps only user text visible', async () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [
        { type: 'text', text: reference },
        { type: 'text', text: '请描述这张图片' },
      ],
    })} />)

    await waitFor(() => { expect(view.getByAltText('screen.png')).toBeTruthy() })
    expect(view.queryByText(reference)).toBeNull()
    expect(view.getByText('请描述这张图片')).toBeTruthy()
  })

  it('loads a projected visual asset without using generic message-image authorization', async () => {
    const loadImage = vi.fn().mockRejectedValue(new Error('ATTACHMENT_NOT_REFERENCED'))
    const loadVisionImage = vi.fn().mockResolvedValue('blob:vision-screen')
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: reference }],
      loadImage,
      loadVisionImage,
    })} />)

    await waitFor(() => { expect(view.getByAltText('screen.png')).toBeTruthy() })
    expect(loadImage).not.toHaveBeenCalled()
    expect(loadVisionImage).toHaveBeenCalledWith('session-1', authorization)
  })

  it('copies only user-authored text after hiding an authorized model reference', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const view = render(<VisionUserMessageNodeView {...props({
      content: [
        { type: 'text', text: reference },
        { type: 'text', text: '读取图中文字' },
      ],
    })} />)

    fireEvent.click(view.getByRole('button', { name: '复制' }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('读取图中文字') })
  })

  it('keeps the reference visible until its durable authorization event is loaded', () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: reference }],
      authorized: false,
    })} />)

    expect(view.getByText(reference)).toBeTruthy()
    expect(view.queryByRole('img')).toBeNull()
  })

  it('preserves ordinary user messages while shadowing the built-in renderer', () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: '普通文本消息' }],
    })} />)

    expect(view.getByText('普通文本消息')).toBeTruthy()
    expect(view.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('decorates a message made entirely of one sent reference token', () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: '/inspect' }],
    })} />)

    expect(view.getByText('/inspect').getAttribute('data-ref-chip')).toBe('skill')
  })

  it('preserves native images and unknown blocks and decorates sent skill and subagent references', async () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [
        { type: 'image', attachment: nativeAttachment },
        { type: 'image' },
        { type: 'text', text: 42 },
        { type: 'custom', value: 'kept' },
        { type: 'text', text: '先用 /inspect 再问 @vision-agent 完成' },
      ],
      probeEquality: true,
    })} />)

    await waitFor(() => { expect(view.getByAltText('native.jpg')).toBeTruthy() })
    expect(view.getByText('/inspect').getAttribute('data-ref-chip')).toBe('skill')
    expect(view.getByText('@vision-agent').getAttribute('data-ref-chip')).toBe('subagent')
    expect(view.getAllByRole('button', { name: /额外内容块/ })).toHaveLength(3)
  })

  it('uses localized truncation copy for oversized unknown blocks', () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'custom', value: 'x'.repeat(20_001) }],
    })} />)

    fireEvent.click(view.getByRole('button', { name: /额外内容块/ }))
    expect(view.getByText(/已截断/)).toBeTruthy()
  })

  it('keeps a valid reference visible when the indexed node has another kind', () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: reference }],
      assetNode: { kind: 'user' } as ChatConversationViewNode,
    })} />)

    expect(view.getByText(reference)).toBeTruthy()
  })

  it('does not reinterpret partial, multiline, or unrelated reference-looking text', () => {
    const texts = [
      `prefix ${reference}`,
      `${reference}\nsuffix`,
      'Visual asset available through luna: asset_id=not-a-vision-id.',
    ]
    const view = render(<VisionUserMessageNodeView {...props({
      content: texts.map(text => ({ type: 'text', text })),
    })} />)

    expect(view.container.textContent).toContain(texts.join(''))
  })

  it('renders image-only content without an empty text bubble', async () => {
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: reference }],
    })} />)

    await waitFor(() => { expect(view.getByAltText('screen.png')).toBeTruthy() })
    expect(view.queryByText(reference)).toBeNull()
    expect(view.container.querySelector('[class*=bubble]')).toBeNull()
  })

  it('formats today, same-year, and prior-year clocks from the live calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 17, 23, 59, 59, 900))

    const today = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: 'today' }],
      time: new Date(2026, 7, 17, 8, 5).getTime(),
    })} />)
    expect(today.getByText('08:05')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(100) })
    expect(today.getByText('08-17 08:05')).toBeTruthy()
    today.unmount()

    const priorYear = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: 'prior year' }],
      time: new Date(2025, 0, 2, 3, 4).getTime(),
    })} />)
    expect(priorYear.getByText('2026-08-17 03:04')).toBeTruthy()
  })

  it('guards repeated copy, resets copied feedback, and handles clipboard failure', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const view = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: 'copy me' }],
    })} />)
    const copy = view.getByRole('button', { name: '复制' })
    fireEvent.click(copy)
    fireEvent.click(copy)
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledOnce()
    const copied = view.getByRole('button', { name: '已复制' })
    fireEvent.click(copied)
    expect(writeText).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(view.getByRole('button', { name: '复制' })).toBeTruthy()
    view.unmount()

    const failedWrite = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: failedWrite },
    })
    const failed = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: 'cannot copy' }],
    })} />)
    fireEvent.click(failed.getByRole('button', { name: '复制' }))
    await act(async () => { await Promise.resolve() })
    expect(failed.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('ignores a clipboard completion after the renderer unmounts and cancels active feedback', async () => {
    let resolveWrite: (() => void) | undefined
    const writeText = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const pending = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: 'pending copy' }],
    })} />)
    fireEvent.click(pending.getByRole('button', { name: '复制' }))
    pending.unmount()
    await act(async () => { resolveWrite?.(); await Promise.resolve() })

    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    const active = render(<VisionUserMessageNodeView {...props({
      content: [{ type: 'text', text: 'active feedback' }],
    })} />)
    fireEvent.click(active.getByRole('button', { name: '复制' }))
    await act(async () => { await Promise.resolve() })
    expect(active.getByRole('button', { name: '已复制' })).toBeTruthy()
    active.unmount()
  })
})
