/** Replayable visual-asset projection for user and steering message bubbles. */

import {
  memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  conversationContextKey,
  type ChatConversationViewNode,
  type ClientContext,
  type ConversationNodeDefinition,
  type UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ImageGallery, type MessageImageLabels } from '@deepseek-ai/dsh-client-ui-attachment'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  JsonBlock,
  MessageText,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ChatNode,
  ChatNodeViewProps,
  ChatViewSlotProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  VisionAssetId,
  VisionAssetEventData,
} from '@deepseek-ai/dsh-tool-vision-luna/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import css from './presentation.module.css'

/** Hidden Chat data used as a direct-key attachment index during message rendering. */
export interface VisionAssetChatData {
  /** Durable authorization event data for the indexed Session asset. */
  readonly authorization: VisionAssetEventData
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Hidden durable attachment index for one authorized Luna visual asset. */
    'vision-luna-asset': VisionAssetChatData
  }
}

/** Conversation Definition kind and Chat key used for authorized visual assets. */
const VISION_ASSET_KIND = 'vision-luna-asset'
const EMPTY_ASSET_NODES: readonly (ChatConversationViewNode | undefined)[] = []

/** Lower values shadow the built-in priority-zero user renderers. */
export const VISION_MESSAGE_RENDER_PRIORITY = -10

/** Durable authorization event projected as a hidden, directly addressable Chat node. */
export const visionAssetDefinition: ConversationNodeDefinition<VisionAssetChatData> = {
  kind: VISION_ASSET_KIND,
  target: 'chat',
  match: event => event.type === 'vision/asset'
    ? { id: String(event.data.assetId), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'vision/asset') {
      throw new Error('vision-luna-asset start requires vision/asset')
    }
    return { authorization: match.event.data }
  },
  update: context => context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined || context.start === undefined) return null
    return {
      key: context.key,
      kind: VISION_ASSET_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'hidden',
      data: context.state,
    }
  },
}

interface PlainTextPart {
  readonly kind: 'plain'
  readonly text: string
}

interface VisionTextPart {
  readonly kind: 'vision'
  readonly text: string
  readonly assetId: VisionAssetId
}

type ProjectedTextPart = PlainTextPart | VisionTextPart
type UserImageBlock = Extract<UserMessageNode['content'][number], { type: 'image' }>

interface ParsedUserContent {
  readonly textParts: readonly ProjectedTextPart[]
  readonly visionParts: readonly VisionTextPart[]
  readonly nativeImages: readonly { attachment: ImageAttachmentRef }[]
  readonly rest: readonly unknown[]
}

/** Recognize only the complete model-reference block emitted by this plugin. */
function parseVisionReference(text: string): VisionTextPart | undefined {
  const match = /^Visual asset available through [^\r\n]+: asset_id=(vision:[A-Za-z0-9:_-]+)\.$/.exec(text)
  const assetId = match?.[1]
  return assetId === undefined
    ? undefined
    : { kind: 'vision', text, assetId: assetId as VisionAssetId }
}

function parseUserContent(content: readonly unknown[]): ParsedUserContent {
  const textParts: ProjectedTextPart[] = []
  const visionParts: VisionTextPart[] = []
  const nativeImages: { attachment: ImageAttachmentRef }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const candidate = block as { type?: string; text?: string; attachment?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      const reference = parseVisionReference(candidate.text)
      if (reference === undefined) textParts.push({ kind: 'plain', text: candidate.text })
      else {
        textParts.push(reference)
        visionParts.push(reference)
      }
    } else if (candidate.type === 'image' && candidate.attachment !== undefined) {
      nativeImages.push({ attachment: (candidate as UserImageBlock).attachment })
    } else {
      rest.push(block)
    }
  }
  return { textParts, visionParts, nativeImages, rest }
}

function sameNodeReferences(
  left: readonly (ChatConversationViewNode | undefined)[],
  right: readonly (ChatConversationViewNode | undefined)[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function visionAuthorization(node: ChatConversationViewNode | undefined): VisionAssetEventData | undefined {
  if (node?.kind !== VISION_ASSET_KIND) return undefined
  return (node as ChatNode<'vision-luna-asset'>).data.authorization
}

interface DisplayContent {
  readonly text: string
  readonly images: readonly { attachment: ImageAttachmentRef }[]
  readonly visualAuthorizationByAttachmentId: ReadonlyMap<string, VisionAssetEventData>
  readonly rest: readonly unknown[]
}

function displayContent(
  parsed: ParsedUserContent,
  nodes: readonly (ChatConversationViewNode | undefined)[],
): DisplayContent {
  const attachments = new Map<VisionAssetId, ImageAttachmentRef>()
  const visualAuthorizationByAttachmentId = new Map<string, VisionAssetEventData>()
  parsed.visionParts.forEach((part, index) => {
    const authorization = visionAuthorization(nodes[index])
    if (authorization !== undefined) {
      attachments.set(part.assetId, authorization.attachment)
      visualAuthorizationByAttachmentId.set(String(authorization.attachment.attachmentId), authorization)
    }
  })
  return {
    text: parsed.textParts
      .filter(part => part.kind === 'plain' || !attachments.has(part.assetId))
      .map(part => part.text)
      .join(''),
    images: [
      ...parsed.nativeImages,
      ...parsed.visionParts.flatMap((part) => {
        const attachment = attachments.get(part.assetId)
        return attachment === undefined ? [] : [{ attachment }]
      }),
    ],
    visualAuthorizationByAttachmentId,
    rest: parsed.rest,
  }
}

function projectUserText(text: string): ReactNode {
  const reference = /(^|\s)([/@][\w-]+)(?=\s|$)/g
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = reference.exec(text)) !== null) {
    const captures = match as RegExpExecArray & { readonly 1: string; readonly 2: string }
    const tokenStart = captures.index + captures[1].length
    const label = captures[2]
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    parts.push(
      <span key={tokenStart} className={css.refChip} data-ref-chip={label.startsWith('@') ? 'subagent' : 'skill'}>
        {label}
      </span>,
    )
    cursor = tokenStart + label.length
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return <>{parts}</>
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function millisecondsUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return next.getTime() - ms
}

function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = (): void => {
      const now = Date.now()
      setDay(startOfLocalDay(now))
      timer = setTimeout(arm, millisecondsUntilNextLocalMidnight(now))
    }
    timer = setTimeout(arm, millisecondsUntilNextLocalMidnight(Date.now()))
    return () => { clearTimeout(timer) }
  }, [])
  return day
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatMessageClock(time: number, t: ChatViewSlotProps['t'], now: number): string {
  const date = new Date(time)
  const current = new Date(now)
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (
    date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate()
  ) return clock
  const params = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() }
  const calendar = date.getFullYear() === current.getFullYear()
    ? t('clock.md', params)
    : t('clock.ymd', params)
  return `${calendar} ${clock}`
}

function CopyAndClock({ text, time, t }: {
  text: string
  time: number
  t: ChatViewSlotProps['t']
}): ReactNode {
  const day = useCalendarDay()
  const [copied, setCopied] = useState(false)
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  useEffect(() => () => {
    epoch.current += 1
    pending.current = false
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  const copy = useCallback(() => {
    if (copied || pending.current) return
    const started = epoch.current
    pending.current = true
    void writeClipboard(text).then((ok) => {
      if (started !== epoch.current) return
      pending.current = false
      if (!ok) return
      setCopied(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setCopied(false)
      }, 1_000)
    })
  }, [copied, text])
  return (
    <div className={css.actions}>
      <span className={css.time}>{formatMessageClock(time, t, day)}</span>
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={copy}>
          {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        </button>
      </Tooltip>
    </div>
  )
}

function messageImageLabels(t: ChatViewSlotProps['t']): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: { dialog: t('image.preview'), close: t('image.closePreview') },
  }
}

/**
 * Resolve one visual asset into a browser image URL.
 * @param sessionId - exact Session whose durable event authorizes the asset.
 * @param authorization - durable data projected from the authorizing event.
 * @returns browser-consumable URL for the verified image bytes.
 */
export type VisionImageLoader = (
  sessionId: SessionId,
  authorization: VisionAssetEventData,
) => Promise<string>

type VisionUserMessageNodeViewProps = Omit<ChatNodeViewProps<'user'>, 'node'> & {
  /** User or admitted-steering node selected by the keyed Chat slot. */
  readonly node: ChatNodeViewProps<'user'>['node'] | ChatNodeViewProps<'steering'>['node']
  /** Resolve a `vision/asset` reference through the owning plugin Remote. */
  readonly loadVisionImage: VisionImageLoader
}

/** User and admitted-steering renderer that hides only references backed by durable authorization events. */
export const VisionUserMessageNodeView = memo(function VisionUserMessageNodeView({
  node,
  loadImage,
  loadVisionImage,
  sessionId,
  useSession,
  t,
}: VisionUserMessageNodeViewProps) {
  const parsed = useMemo(() => parseUserContent(node.data.content), [node.data.content])
  const assetNodes = useSession(snapshot => parsed.visionParts.length === 0
    ? EMPTY_ASSET_NODES
    : parsed.visionParts.map(part => snapshot.chat.nodes.get(
      conversationContextKey(VISION_ASSET_KIND, String(part.assetId)),
    )), sameNodeReferences)
  const content = useMemo(() => displayContent(parsed, assetNodes), [assetNodes, parsed])
  const loadPresentedImage = useCallback((attachment: ImageAttachmentRef): Promise<string> => {
    const authorization = content.visualAuthorizationByAttachmentId.get(String(attachment.attachmentId))
    return authorization === undefined
      ? loadImage(attachment)
      : loadVisionImage(sessionId, authorization)
  }, [content.visualAuthorizationByAttachmentId, loadImage, loadVisionImage, sessionId])
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = content.text !== '' || content.rest.length > 0
  return (
    <div className={css.userRow} data-time-hover-root>
      <div className={css.userStack}>
        <ImageGallery images={content.images} load={loadPresentedImage} align="end" labels={messageImageLabels(t)} />
        {showBubble && <div className={css.bubble}>
          {projectUserText(content.text)}
          {content.rest.map((block, index) => (
            <JsonBlock
              key={index}
              label={t('message.extraBlock')}
              payload={block}
              truncatedLabel={truncated}
            />
          ))}
        </div>}
      </div>
      <CopyAndClock text={content.text} time={node.data.time} t={t} />
    </div>
  )
})

/**
 * Register both renderer shadows while the conversation Chat slot is declared.
 * @param ctx - client context that owns the renderer contributions.
 * @param loadVisionImage - Session-authorized loader owned by this plugin's Remote.
 */
export function registerVisionMessageRenderers(ctx: ClientContext, loadVisionImage: VisionImageLoader): void {
  const Renderer = (props: ChatNodeViewProps<'user' | 'steering'>): ReactNode => (
    <VisionUserMessageNodeView {...props} loadVisionImage={loadVisionImage} />
  )
  ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'user',
      priority: VISION_MESSAGE_RENDER_PRIORITY,
      locale: 'conversation',
    }, Renderer)
    yield ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'steering',
      priority: VISION_MESSAGE_RENDER_PRIORITY,
      locale: 'conversation',
    }, Renderer)
  })
}
