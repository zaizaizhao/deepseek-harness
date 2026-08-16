import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('tool-vision-luna invariant companion', () => {
  it('reserves package ownership and releases it with the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = ctx.plugin(invariant)
    await fiber.await()
    expect(invariant.name).toBe('tool-vision-luna-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-tool-vision-luna', () => {}))
      .toThrow('already registered')
    await fiber.dispose()
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-tool-vision-luna', () => {})).not.toThrow()
  })
})
