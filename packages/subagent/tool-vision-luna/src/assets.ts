/** Durable visual-asset admission, authorization, and resolution. */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { basename, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import { downloadRemoteImage } from './url-image.ts'
import { VisionError } from './errors.ts'
import { VisionAssetId } from './types.ts'
import type {
  VisionAssetId as VisionAssetIdType,
  VisionAssetEventData,
  VisionAssetSource,
  VisionAssetTrace,
  VisionUploadImage,
  VisionUploadRequest,
  VisionUploadResult,
} from './types.ts'

/** Model-facing input selector accepted by the visual asset resolver. */
export type VisionAssetInput =
  | { readonly asset_id: string }
  | { readonly file_path: string }
  | { readonly url: string }

/** Resolved durable image supplied to the visual child. */
export interface ResolvedVisionAsset {
  readonly assetId: VisionAssetIdType
  readonly attachment: ImageAttachmentRef
}

interface PendingImage {
  readonly input: SaveImageAttachment
  readonly source: VisionAssetSource
}

interface PendingRecord {
  readonly ref: ImageAttachmentRef
  readonly source: VisionAssetSource
}

/**
 * Derive the stable visual id from the attachment store's content address.
 * @param ref - durable attachment reference.
 * @returns Session-scoped visual asset id derived from the immutable object id.
 */
export function assetIdFor(ref: ImageAttachmentRef): VisionAssetIdType {
  return VisionAssetId(`vision:${ref.attachmentId}`)
}

/**
 * Convert one durable image to the non-secret trace included in Tool output.
 * @param asset - authorized durable image.
 * @returns immutable model-facing provenance without storage paths.
 */
export function traceFor(asset: ResolvedVisionAsset): VisionAssetTrace {
  return Object.freeze({
    assetId: asset.assetId,
    mediaType: asset.attachment.mediaType,
    bytes: asset.attachment.bytes,
    width: asset.attachment.width,
    height: asset.attachment.height,
  })
}

/** Host-side asset admission and per-Session authorization owner. */
export class VisionAssetResolver {
  /**
   * @param ctx - Host context carrying the durable attachment and Session services.
   * @param config - URL and size policy owned by this plugin.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /**
   * Validate every browser image, save the batch, then commit one authorization checkpoint.
   * @param agent - exact Session authorization owner resolved by Typert.
   * @param request - browser bytes and declaration.
   * @returns durable upload receipt.
   */
  async upload(agent: Agent, request: VisionUploadRequest): Promise<VisionUploadResult> {
    const limits = this.ctx.attachments.imageLimits
    if (request.images.length === 0 || request.images.length > limits.maxImagesPerMessage) {
      throw new VisionError(
        `images must contain 1-${limits.maxImagesPerMessage} items`,
        'VISION_TOO_MANY_ASSETS',
      )
    }
    const pending = request.images.map(image => this.uploadInput(image))
    assertUniquePendingContent(pending, 'uploaded images')
    const totalBytes = pending.reduce((sum, item) => sum + item.input.data.byteLength, 0)
    if (totalBytes > limits.maxMessageImageBytes) {
      throw new VisionError(
        `uploaded image batch exceeds the ${limits.maxMessageImageBytes}-byte aggregate limit`,
        'VISION_TOO_MANY_ASSETS',
      )
    }
    await Promise.all(pending.map(item => this.ctx.attachments.validateImage(item.input)))
    const records: PendingRecord[] = []
    for (const item of pending) {
      records.push({ ref: await this.ctx.attachments.saveImage(item.input), source: item.source })
    }
    assertUniqueAssetIds(records.map(item => assetIdFor(item.ref)), 'uploaded images')
    const assets = await this.recordMany(agent.session, records)
    return Object.freeze({
      toolName: this.config.toolName,
      assets: Object.freeze(assets.map(asset => Object.freeze({
        assetId: asset.assetId,
        mediaType: asset.attachment.mediaType,
        bytes: asset.attachment.bytes,
        width: asset.attachment.width,
        height: asset.attachment.height,
        ...(asset.attachment.name === undefined ? {} : { name: asset.attachment.name }),
      }))),
    })
  }

  /**
   * Read one visual asset after resolving its exact Session authorization event.
   * @param agent - Session whose durable event authorizes the asset.
   * @param assetId - opaque id projected from that Session's authorization event.
   * @param signal - Remote caller cancellation.
   * @returns canonical base64 image data for browser display.
   */
  async read(
    agent: Agent,
    assetId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const authoritative = this.authorization(agent.session, assetId)
    const stored = await this.ctx.attachments.readImage(authoritative.attachment, signal)
    signal.throwIfAborted()
    return Buffer.from(stored.data).toString('base64')
  }

  /**
   * Resolve an ordered Tool batch, validating every new image before saving any.
   * @param agent - parent Agent and Session authorization owner.
   * @param inputs - asset ids, workspace paths, or allowed HTTPS URLs.
   * @param signal - tool/job/lifecycle cancellation.
   * @returns ordered, unique durable assets.
   */
  async resolve(agent: Agent, inputs: readonly VisionAssetInput[], signal: AbortSignal): Promise<ResolvedVisionAsset[]> {
    const limits = this.ctx.attachments.imageLimits
    if (inputs.length === 0 || inputs.length > limits.maxImagesPerMessage) {
      throw new VisionError(
        `assets must contain 1-${limits.maxImagesPerMessage} images`,
        'VISION_TOO_MANY_ASSETS',
      )
    }
    const resolved: Array<ResolvedVisionAsset | PendingImage> = []
    for (const input of inputs) {
      if ('asset_id' in input) resolved.push(this.authorized(agent.session, input.asset_id))
      else if ('file_path' in input) resolved.push(await this.readPath(agent, input.file_path, signal))
      else resolved.push(await this.readUrl(input.url, signal))
    }
    let totalBytes = 0
    for (const item of resolved) {
      totalBytes += 'attachment' in item ? item.attachment.bytes : item.input.data.byteLength
    }
    if (totalBytes > limits.maxMessageImageBytes) {
      throw new VisionError(
        `visual asset batch exceeds the ${limits.maxMessageImageBytes}-byte aggregate limit`,
        'VISION_TOO_MANY_ASSETS',
      )
    }
    const pending = resolved.filter((item): item is PendingImage => !('attachment' in item))
    assertUniquePendingContent(pending, 'assets')
    await Promise.all(pending.map(item => this.ctx.attachments.validateImage(item.input)))
    const provisional: Array<ResolvedVisionAsset | PendingRecord> = []
    for (const item of resolved) {
      if ('attachment' in item) provisional.push(item)
      else {
        const ref = await this.ctx.attachments.saveImage(item.input)
        provisional.push({ ref, source: item.source })
      }
    }
    const ids = provisional.map(item => 'attachment' in item ? item.assetId : assetIdFor(item.ref))
    assertUniqueAssetIds(ids, 'assets')
    const recorded = await this.recordMany(
      agent.session,
      provisional.filter((item): item is PendingRecord => !('attachment' in item)),
    )
    let recordedIndex = 0
    const output = provisional.map((item): ResolvedVisionAsset => {
      if ('attachment' in item) return item
      const asset = recorded[recordedIndex]
      recordedIndex += 1
      /* v8 ignore next -- recordMany preserves one output per pending record. */
      if (asset === undefined) throw new Error('visual asset checkpoint omitted a pending image')
      return asset
    })
    return output
  }

  private uploadInput(image: VisionUploadImage): PendingImage {
    const data = this.decodeUpload(image.data)
    const name = sanitizeName(image.name)
    return {
      input: {
        data,
        mediaType: image.mediaType,
        ...(name === undefined ? {} : { name }),
      },
      source: { kind: 'upload', ...(name === undefined ? {} : { name }) },
    }
  }

  private decodeUpload(data: string): Uint8Array {
    const maxBytes = Math.min(
      this.ctx.attachments.imageLimits.maxImageBytes,
      this.ctx.attachments.imageLimits.maxMessageImageBytes,
    )
    const maxBase64 = Math.ceil(maxBytes / 3) * 4
    if (data.length === 0 || data.length > maxBase64 || data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new VisionError('uploaded image data is not canonical bounded base64', 'VISION_INVALID_ASSET')
    }
    const decoded = Buffer.from(data, 'base64')
    if (decoded.byteLength > maxBytes || decoded.toString('base64') !== data) {
      throw new VisionError('uploaded image data is not canonical bounded base64', 'VISION_INVALID_ASSET')
    }
    return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
  }

  private authorized(session: Session, raw: string): ResolvedVisionAsset {
    const authorization = this.authorization(session, raw)
    return { assetId: authorization.assetId, attachment: authorization.attachment }
  }

  private authorization(session: Session, raw: string): VisionAssetEventData {
    const found = session.events.findLast((event): event is SessionEvent<'vision/asset'> =>
      event.type === 'vision/asset' && event.data.assetId === raw)
    if (found === undefined) {
      throw new VisionError(`visual asset ${JSON.stringify(raw)} is not authorized for this Session`, 'VISION_ASSET_FORBIDDEN')
    }
    return found.data
  }

  private async readPath(agent: Agent, path: string, signal: AbortSignal): Promise<PendingImage> {
    if (path.trim().length === 0) throw new VisionError('file_path must be a non-empty string', 'VISION_INVALID_ASSET')
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new VisionError('file_path requires a Session workspace', 'VISION_ASSET_FORBIDDEN')
    const fs: FileSystem | undefined = agent.ctx.get('fs')
    if (fs === undefined) throw new VisionError('visual path input requires the Agent filesystem service', 'VISION_UNAVAILABLE')
    const pathInfo = await fs.lstat(path, { cwd }, signal)
    if (pathInfo === undefined) throw new VisionError(`visual file ${JSON.stringify(path)} was not found`, 'VISION_INVALID_ASSET')
    if (pathInfo.type === 'symlink') throw new VisionError('visual file paths must not be symbolic links', 'VISION_ASSET_FORBIDDEN')
    const [root, target] = await Promise.all([
      fs.resolve(cwd, { signal }),
      fs.resolve(path, { cwd, signal }),
    ])
    if (!fs.contains(root, target)) {
      throw new VisionError('visual file path resolves outside the Session workspace', 'VISION_ASSET_FORBIDDEN')
    }
    const info = await fs.stat(target, signal)
    if (info?.type !== 'file') throw new VisionError('visual file path is not a regular file', 'VISION_INVALID_ASSET')
    const maxBytes = Math.min(
      this.ctx.attachments.imageLimits.maxImageBytes,
      this.ctx.attachments.imageLimits.maxMessageImageBytes,
    )
    const data = await fs.readBytes(target, signal, maxBytes)
    const mediaType = detectImageMediaType(data)
    const displayPath = relative(fs.processPath(root), fs.processPath(target)).split('\\').join('/')
    const name = sanitizeName(basename(path))
    return {
      input: { data, mediaType, ...(name === undefined ? {} : { name }) },
      source: { kind: 'path', path: displayPath },
    }
  }

  private async readUrl(raw: string, signal: AbortSignal): Promise<PendingImage> {
    const maxBytes = Math.min(
      this.ctx.attachments.imageLimits.maxImageBytes,
      this.ctx.attachments.imageLimits.maxMessageImageBytes,
    )
    const downloaded = await downloadRemoteImage(raw, this.config, maxBytes, signal)
    const name = sanitizeName(basename(downloaded.finalUrl.pathname))
    return {
      input: {
        data: downloaded.data,
        mediaType: detectImageMediaType(downloaded.data),
        ...(name === undefined ? {} : { name }),
      },
      source: {
        kind: 'url',
        origin: downloaded.finalUrl.origin,
        pathname: downloaded.finalUrl.pathname,
      },
    }
  }

  private async recordMany(session: Session, records: readonly PendingRecord[]): Promise<ResolvedVisionAsset[]> {
    const output = records.map(({ ref, source }): ResolvedVisionAsset => {
      const assetId = assetIdFor(ref)
      const existing = session.events.findLast((event): event is SessionEvent<'vision/asset'> =>
        event.type === 'vision/asset' && event.data.assetId === assetId)
      if (existing !== undefined) return { assetId, attachment: existing.data.attachment }
      session.append('vision/asset', { assetId, attachment: ref, source })
      return { assetId, attachment: ref }
    })
    if (records.length > 0 && !(await this.ctx.sessions.flush(session))) {
      throw new VisionError('no Session durability listener accepted the visual asset checkpoint', 'VISION_DURABILITY_FAILED')
    }
    return output
  }
}

/** Reject duplicate bytes before a batch can publish any new attachment object. */
function assertUniquePendingContent(pending: readonly PendingImage[], label: string): void {
  const digests = pending.map(item => createHash('sha256').update(item.input.data).digest('hex'))
  if (new Set(digests).size !== digests.length) {
    throw new VisionError(`${label} must not contain duplicate image content`, 'VISION_INVALID_ASSET')
  }
}

/** Reject a storage-level identity collision before Session authorization. */
function assertUniqueAssetIds(ids: readonly VisionAssetIdType[], label: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new VisionError(`${label} must not contain duplicate image content`, 'VISION_INVALID_ASSET')
  }
}

/**
 * Sniff the four supported raster signatures before authoritative decode validation.
 * @param data - complete bounded encoded image bytes.
 * @returns detected Harness image media type.
 */
export function detectImageMediaType(data: Uint8Array): ImageMediaType {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  const ascii = (start: number, length: number): string => Buffer.from(data.subarray(start, start + length)).toString('ascii')
  if (data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  if (data.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif'
  throw new VisionError('visual asset bytes are not PNG, JPEG, WebP, or GIF', 'VISION_INVALID_ASSET')
}

/**
 * Remove path components and empty names before metadata persistence.
 * @param value - optional browser, path, or URL-derived name.
 * @returns bounded basename, or undefined when no usable name remains.
 */
export function sanitizeName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const name = value.split(/[\\/]/).at(-1)?.trim()
  if (name === undefined || name.length === 0) return undefined
  return name.slice(0, 255)
}
