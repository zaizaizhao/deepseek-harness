/** Deterministic model boundary for the assembled Luna-vision snapshot. */

import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

const PARENT_PROVIDER = 'deepseek-official'
const CHILD_PROVIDER = 'zaizaizhao'

/** Stable fixture plugin name. */
export const name = 'vision-luna-model-fixture'
/** LLM registry required before fixture route registration. */
export const inject = ['llm']

/** Emit a complete deterministic text response. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Emit one deterministic tool call. */
function toolCallResponse(id: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(id)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Two-route fixture that asserts the parent/child modality split at the model seam. */
class VisionFixtureAdapter extends LlmAdapter {
  private parentCalls = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: provider === CHILD_PROVIDER ? ['text', 'image'] : ['text'],
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const content = options.messages.flatMap(message => message.content)
    if (options.provider === PARENT_PROVIDER) {
      if (content.some(block => block.type === 'image')) {
        throw new Error('vision fixture: text-only parent received a raw image block')
      }
      this.parentCalls += 1
      const chunks = this.parentCalls === 1
        ? toolCallResponse('vision-parent-call', 'gpt_luna_vision', {
          question: 'What color is the image?',
          assets: [{ file_path: 'red.png' }],
        })
        : textResponse('VISION_DONE')
      yield * chunks
      return
    }
    if (options.provider !== CHILD_PROVIDER || options.model !== 'gpt-5.6-luna') {
      throw new Error(`vision fixture: unexpected route ${options.provider}/${options.model}`)
    }
    if (!content.some(block => block.type === 'image')) {
      throw new Error('vision fixture: Luna child received no image block')
    }
    if (options.tools?.some(tool => tool.name === 'structured_output') !== true) {
      throw new Error('vision fixture: Luna child received no structured_output tool')
    }
    yield * toolCallResponse('vision-structured-call', 'structured_output', {
      answer: 'The image is red.',
      ocr: '',
      observations: [{ region: 'entire image', fact: 'The visible pixel is red.' }],
      uncertainty: [],
    })
  }
}

/** Register deterministic parent and child routes. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter([PARENT_PROVIDER, CHILD_PROVIDER], new VisionFixtureAdapter())
}
