import { Buffer } from 'node:buffer'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from '../src/config.ts'
import type { ResolvedVisionAsset } from '../src/assets.ts'
import { VisionAssetId } from '../src/types.ts'

export const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

export const GIF = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'))

export const config = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig => Object.freeze({
  provider: 'zaizaizhao',
  model: 'gpt-5.6-luna',
  maxTokens: 4096,
  toolName: 'gpt_luna_vision',
  enableRunInBackground: true,
  maxDepth: 1,
  maxConcurrency: 1,
  cacheMaxEntries: 4,
  maxQuestionBytes: 1024,
  visionTimeoutMs: 1000,
  allowedUrlOrigins: Object.freeze([]),
  urlTimeoutMs: 1000,
  maxRedirects: 3,
  maxUrlLength: 4096,
  ...overrides,
})

const attachment = (id = 'fixture'): ImageAttachmentRef => Object.freeze({
  attachmentId: AttachmentId(id),
  mediaType: 'image/png',
  bytes: PNG.byteLength,
  width: 1,
  height: 1,
})

export const asset = (id = 'fixture'): ResolvedVisionAsset => ({
  assetId: VisionAssetId(`vision:${id}`),
  attachment: attachment(id),
})

export function fakeAgent(ctx: Context, id = 'parent', cwd?: string): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 0,
    ...(cwd === undefined ? {} : { cwd }),
  })
  return {
    id: sessionId,
    ctx,
    session,
  } as unknown as Agent
}
