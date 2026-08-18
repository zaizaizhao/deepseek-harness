/** Browser image upload and sent-message reads through the governed Luna vision Host service. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationImageIntake,
  ConversationImageIntakeRequest,
  ConversationTextPromptPart,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import visionLunaRemote from '@deepseek-ai/dsh-tool-vision-luna/remote'
import type {
  VisionAssetEventData,
  VisionImageMediaType,
  VisionUploadImage,
  VisionUploadResult,
} from '@deepseek-ai/dsh-tool-vision-luna/types'
import {
  registerVisionMessageRenderers,
  visionAssetDefinition,
  type VisionImageLoader,
} from './presentation.tsx'

/** Services required for the Remote, durable asset projection, and Chat renderer shadows. */
export const inject = ['remote', 'conversationEvents', 'slots']

/** Services required while the conversation image intake is registered. */
const intakeInject = ['conversation', 'remote', 'remote.visionLuna']

/**
 * Install the generated Remote, durable asset projection, message renderers, and image intake adapter.
 * @param ctx - client context that owns every contribution.
 * @returns asynchronous disposer for the mounted Remote and intake fiber.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(visionLunaRemote)
  const presentation = new AbortController()
  try {
    const mountedNamespace: unknown = ctx.get('remote.visionLuna')
    const visionLuna = mountedNamespace as ClientContext['remote']['visionLuna'] | undefined
    if (visionLuna === undefined) throw new Error('visionLuna Remote did not mount its namespace')
    ctx.conversationEvents.register(visionAssetDefinition)
    registerVisionMessageRenderers(ctx, visionImageLoader(visionLuna, presentation.signal))
    const intakeFiber = ctx.inject(intakeInject, (intakeCtx: ClientContext) => {
      const adapter: ConversationImageIntake = {
        prepare: request => uploadImages(intakeCtx, request),
      }
      return intakeCtx.conversation.registerImageIntake(adapter)
    })
    try {
      await intakeFiber
    } catch (error) {
      await intakeFiber.dispose()
      throw error
    }
    return async () => {
      presentation.abort('Luna sent-message presentation was unloaded')
      await intakeFiber.dispose()
      await disposeRemote()
    }
  } catch (error) {
    presentation.abort('Luna sent-message presentation failed to load')
    await disposeRemote()
    throw error
  }
}

/** Resolve only plugin-authorized visual assets; native message images keep the Harness loader. */
function visionImageLoader(
  remote: ClientContext['remote']['visionLuna'],
  signal: AbortSignal,
): VisionImageLoader {
  return async (sessionId, expected: VisionAssetEventData): Promise<string> => {
    if (signal.aborted) throw new Error('Luna sent-message presentation was cancelled', { cause: signal.reason })
    const carried = await remote.read(sessionId, String(expected.assetId), signal)
    if (!carried.ok) {
      throw new Error(`visionLuna.read failed: ${carried.error.code}: ${carried.error.message}`)
    }
    return `data:${expected.attachment.mediaType};base64,${carried.value}`
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
  if (request.files.length === 0) return []
  const images: VisionUploadImage[] = []
  for (const file of request.files) {
    assertIntakeActive(request.signal)
    images.push({
      data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      mediaType: imageMediaType(file.type),
      ...(file.name === '' ? {} : { name: file.name }),
    })
  }
  const carried = await ctx.remote.visionLuna.upload(request.sessionId, { images }, request.signal)
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
