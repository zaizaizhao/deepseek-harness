import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('vision-luna bundle invariant companion', () => {
  it('reserves and releases package ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = ctx.plugin(invariant)
    await fiber.await()
    expect(invariant.name).toBe('vision-luna-bundle-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-vision-luna', () => {})).toThrow('already registered')
    await fiber.dispose()
    expect(() => ctx.invariants.register('@deepseek-ai/dsh-vision-luna', () => {})).not.toThrow()
  })
})
