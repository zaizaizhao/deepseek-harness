/** Browser submit-time image upload into the governed Luna vision Host service. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationImageIntake,
  ConversationImageIntakeRequest,
  ConversationTextPromptPart,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import visionLunaRemote from '@deepseek-ai/dsh-tool-vision-luna/remote'
import type {
  VisionImageMediaType,
  VisionUploadImage,
  VisionUploadResult,
} from '@deepseek-ai/dsh-tool-vision-luna/types'

/** Services required for Session-scoped Remote upload and conversation intake registration. */
export const inject = ['sessions', 'remote', 'conversation']

/** Install the generated Remote contribution and the sole conversation image intake adapter. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(visionLunaRemote)
  let disposeIntake: () => Promise<void>
  try {
    const adapter: ConversationImageIntake = {
      prepare: request => uploadImages(ctx, request),
    }
    disposeIntake = ctx.conversation.registerImageIntake(adapter)
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await disposeIntake()
    await disposeRemote()
  }
}

/** Reject browser work after adapter or conversation lifecycle cancellation. */
function assertIntakeActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Luna image intake was cancelled', { cause: signal.reason })
  }
}

/** Upload one submit batch and return only stable asset-reference text to the parent prompt. */
async function uploadImages(
  ctx: ClientContext,
  request: ConversationImageIntakeRequest,
): Promise<readonly ConversationTextPromptPart[]> {
  assertIntakeActive(request.signal)
  const scoped = ctx.sessions.scope(request.sessionId)
  if (scoped === undefined) {
    throw new Error(`visionLuna.upload requires a live Client Session scope for ${JSON.stringify(request.sessionId)}`)
  }
  const images: VisionUploadImage[] = []
  for (const file of request.files) {
    assertIntakeActive(request.signal)
    images.push({
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      mediaType: imageMediaType(file.type),
      ...(file.name === '' ? {} : { name: file.name }),
    })
  }
  const carried = await scoped.remote.visionLuna.upload({ images }, request.signal)
  if (!carried.ok) {
    throw new Error(`visionLuna.upload failed: ${carried.error.code}: ${carried.error.message}`)
  }
  return assetPromptParts(carried.value, request.files.length)
}

/** Enforce the one-receipt-per-file relation that JSON Schema cannot express. */
function assetPromptParts(result: VisionUploadResult, expected: number): ConversationTextPromptPart[] {
  if (result.assets.length !== expected) {
    throw new Error(`visionLuna.upload returned ${result.assets.length} assets for ${expected} files`)
  }
  return result.assets.map(asset => ({
    type: 'text',
    text: `Visual asset available through ${result.toolName}: asset_id=${asset.assetId}.`,
  }))
}

/** Narrow browser MIME input before it crosses the Remote boundary. */
function imageMediaType(value: string): VisionImageMediaType {
  switch (value) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
    case 'image/gif':
      return value
    default:
      throw new Error(`visionLuna.upload received unsupported browser image type ${JSON.stringify(value)}`)
  }
}

/** Encode bytes without applying the call stack to the complete image. */
function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
