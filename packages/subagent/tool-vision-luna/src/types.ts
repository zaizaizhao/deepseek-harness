/** Client-safe request, result, and trace vocabulary for Luna vision delegation. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** Opaque session-authorized reference to one durable visual asset. */
export type VisionAssetId = Branded<'VisionAssetId'>

/**
 * Brand a validated visual asset identifier.
 * @param value - stable asset identifier accepted by the Host.
 * @returns the same value with the visual-asset brand.
 */
export function VisionAssetId(value: string): VisionAssetId {
  return value as VisionAssetId
}

/** Auditable origin of one Session-authorized visual asset. */
export type VisionAssetSource =
  | { readonly kind: 'upload'; readonly name?: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'url'; readonly origin: string; readonly pathname: string }

/** Durable visual-asset authorization recorded before a parent prompt uses its id. */
export interface VisionAssetEventData {
  readonly assetId: VisionAssetId
  readonly attachment: ImageAttachmentRef
  readonly source: VisionAssetSource
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Authorizes one immutable image object for a parent Session.
     * @param data - stable asset id, durable attachment reference, and admitted origin.
     */
    'vision/asset': VisionAssetEventData
  }
}

/** Raster formats accepted by the shared Harness attachment store. */
export type VisionImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One browser image inside an atomic upload request. */
export interface VisionUploadImage {
  /** Complete image bytes encoded as canonical base64. */
  readonly data: string
  /** Browser-declared media type, verified against decoded bytes by the Host. */
  readonly mediaType: VisionImageMediaType
  /** Optional display name without path meaning. */
  readonly name?: string
}

/** Browser-to-Host atomic upload request; API credentials never travel through this contract. */
export interface VisionUploadRequest {
  /** Ordered images validated in full before any Session authorization event is appended. */
  readonly images: readonly VisionUploadImage[]
}

/** Durable receipt for one image in the admitted batch. */
export interface VisionUploadedAsset {
  /** Session-authorized opaque id used by `gpt_luna_vision`. */
  readonly assetId: VisionAssetId
  /** Verified encoded media type. */
  readonly mediaType: VisionImageMediaType
  /** Exact encoded byte length. */
  readonly bytes: number
  /** Intrinsic width in pixels. */
  readonly width: number
  /** Intrinsic height in pixels. */
  readonly height: number
  /** Sanitized optional display name. */
  readonly name?: string
}

/** Atomic upload result returned before the text-only parent prompt is sent. */
export interface VisionUploadResult {
  /** Model-facing tool name selected by Host configuration. */
  readonly toolName: string
  /** Ordered durable receipts corresponding one-to-one with the request images. */
  readonly assets: readonly VisionUploadedAsset[]
}

/** Optional exact pixel rectangle the visual analyst should focus on. */
export interface VisionRegion {
  /** Left edge in intrinsic image pixels. */
  readonly x: number
  /** Top edge in intrinsic image pixels. */
  readonly y: number
  /** Positive rectangle width in intrinsic image pixels. */
  readonly width: number
  /** Positive rectangle height in intrinsic image pixels. */
  readonly height: number
}

/** One factual visual observation tied to a human-readable image region. */
export interface VisionObservation {
  /** Human-readable location such as `top-left` or `x=10,y=20,w=30,h=40`. */
  readonly region: string
  /** Directly visible fact, excluding interpretation not supported by the image. */
  readonly fact: string
}

/** Structured evidence produced by the isolated visual child. */
export interface VisionStructuredEvidence {
  /** Direct answer to the parent's visual question. */
  readonly answer: string
  /** Exact visible text, or an empty string when none is legible. */
  readonly ocr: string
  /** Region-linked factual observations. */
  readonly observations: readonly VisionObservation[]
  /** Explicit ambiguities, occlusions, or confidence limitations. */
  readonly uncertainty: readonly string[]
}

/** Authoritative asset facts attached by the Host, never trusted to child output. */
export interface VisionAssetTrace {
  /** Session-authorized durable asset id. */
  readonly assetId: VisionAssetId
  /** Verified image encoding. */
  readonly mediaType: VisionImageMediaType
  /** Exact encoded byte length. */
  readonly bytes: number
  /** Intrinsic width in pixels. */
  readonly width: number
  /** Intrinsic height in pixels. */
  readonly height: number
}

/** Completed foreground result returned to the text-only parent Agent. */
export interface VisionForegroundResult {
  /** Foreground-result discriminant. */
  readonly kind: 'foreground'
  /** Durable child Session identity, including on a cache hit. */
  readonly childSessionId: string
  /** Child-produced evidence plus Host-owned provenance. */
  readonly evidence: VisionStructuredEvidence & {
    readonly assets: readonly VisionAssetTrace[]
    readonly provider: string
    readonly model: string
    readonly cached: boolean
    readonly warnings: readonly string[]
  }
}

/** Accepted background result collected through the ordinary jobs tools. */
export interface VisionBackgroundResult {
  /** Background-result discriminant. */
  readonly kind: 'background'
  /** Existing jobs-service id collected with `job_output` or stopped with `job_kill`. */
  readonly jobId: string
}

/** Canonical model-tool result. */
export type VisionToolResult = VisionForegroundResult | VisionBackgroundResult
