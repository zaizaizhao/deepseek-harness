import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-vision-luna Node half', () => {
  it('is intentionally empty', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
