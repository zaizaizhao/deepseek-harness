/** Abortable FIFO capacity for foreground and detached background vision runs. */

import { visionAbort, VisionError } from './errors.ts'

interface Waiter {
  readonly signal: AbortSignal
  readonly resolve: (release: () => void) => void
  readonly reject: (error: unknown) => void
  readonly onAbort: () => void
}

/** Bounded, FIFO, cancellation-aware execution admission. */
export class VisionCapacity {
  private active = 0
  private readonly waiters: Waiter[] = []
  private closed = false

  /** @param maximum - positive simultaneous-operation limit. */
  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new TypeError('VisionCapacity maximum must be a positive safe integer')
    }
  }

  /**
   * Run one operation after obtaining a capacity slot.
   * @param signal - cancels queued admission and the caller-owned operation.
   * @param operation - work performed while the slot is held.
   * @returns the operation result.
   */
  async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  /** Reject future and queued admission during plugin teardown. */
  close(): void {
    if (this.closed) return
    this.closed = true
    const error = new VisionError('Luna vision plugin is unloading', 'VISION_UNAVAILABLE')
    for (const waiter of this.waiters.splice(0)) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.reject(error)
    }
  }

  /** Current admitted-operation count for lifecycle invariants and tests. */
  get activeCount(): number {
    return this.active
  }

  /** Current queued-operation count for lifecycle invariants and tests. */
  get queuedCount(): number {
    return this.waiters.length
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    if (this.closed) {
      return Promise.reject(new VisionError('Luna vision plugin is unavailable', 'VISION_UNAVAILABLE'))
    }
    if (signal.aborted) return Promise.reject(visionAbort(signal))
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter)
          this.waiters.splice(index, 1)
          reject(visionAbort(signal))
        },
      }
      this.waiters.push(waiter)
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.drain()
    })
  }

  private drain(): void {
    while (!this.closed && this.active < this.maximum && this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      /* v8 ignore next -- loop condition proves a waiter exists. */
      if (waiter === undefined) return
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      this.active += 1
      waiter.resolve(() => {
        this.active -= 1
        this.drain()
      })
    }
  }
}
