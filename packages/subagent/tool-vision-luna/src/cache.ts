/** Small process-local LRU cache for completed structured vision results. */

/** Bounded LRU map whose values are immutable by caller contract. */
export class VisionCache<Value> {
  private readonly entries = new Map<string, Value>()

  /** @param maximum - positive retained-entry limit. */
  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new TypeError('VisionCache maximum must be a positive safe integer')
    }
  }

  /**
   * Read and promote one entry.
   * @param key - canonical digest key.
   * @returns the retained value, when present.
   */
  get(key: string): Value | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  /**
   * Insert or replace one entry and evict the least-recently-used excess.
   * @param key - canonical digest key.
   * @param value - immutable completed result.
   */
  set(key: string, value: Value): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.maximum) {
      const oldest = this.entries.keys().next().value
      /* v8 ignore next -- positive maximum and oversize prove a key exists. */
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }

  /** Number of retained entries. */
  get size(): number {
    return this.entries.size
  }

  /** Drop every retained result during plugin teardown. */
  clear(): void {
    this.entries.clear()
  }
}
