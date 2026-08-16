/** Stable failures owned by Luna vision delegation. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Machine-routable failure codes emitted before or around the visual child. */
export type VisionErrorCode =
  | 'VISION_INVALID_ASSET'
  | 'VISION_ASSET_FORBIDDEN'
  | 'VISION_URL_FORBIDDEN'
  | 'VISION_URL_NETWORK'
  | 'VISION_URL_TIMEOUT'
  | 'VISION_TOO_MANY_ASSETS'
  | 'VISION_MODEL_UNSUPPORTED'
  | 'VISION_STRUCTURE_INVALID'
  | 'VISION_CANCELLED'
  | 'VISION_TIMEOUT'
  | 'VISION_DURABILITY_FAILED'
  | 'VISION_UNAVAILABLE'

/** Typed visual-delegation failure suitable for Tool error logging. */
export class VisionError extends HarnessError {
  override readonly code: VisionErrorCode

  /**
   * @param message - non-secret diagnosis safe for the parent Agent.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: VisionErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'VisionError'
    this.code = code
  }
}

/**
 * Convert a cancellation signal into one stable visual error.
 * @param signal - already-aborted operation signal.
 * @returns stable cancellation failure retaining the abort reason as its cause.
 */
export function visionAbort(signal: AbortSignal): VisionError {
  return new VisionError('Luna vision operation was cancelled', 'VISION_CANCELLED', { cause: signal.reason })
}
