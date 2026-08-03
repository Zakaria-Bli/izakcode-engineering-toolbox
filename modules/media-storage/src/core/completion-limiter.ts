import {
  MediaConfigurationError,
  MediaRateLimitError,
  MediaUploadAbortedError,
} from "../domain/errors.js"
import type { CompletionLimiter } from "../ports/limiter.js"

export interface InMemoryCompletionLimiterConfig {
  maxConcurrent?: number
  maxQueued?: number
  abortMessage?: string
  rateLimitMessage?: string
}

interface QueuedTask {
  resolve: () => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abortHandler?: () => void
}

export class InMemoryCompletionLimiter implements CompletionLimiter {
  private readonly maxConcurrent: number
  private readonly maxQueued: number
  private readonly abortMessage: string
  private readonly rateLimitMessage: string
  private active = 0
  private readonly queue: QueuedTask[] = []

  constructor(config: InMemoryCompletionLimiterConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 2
    this.maxQueued = config.maxQueued ?? 20
    this.abortMessage = config.abortMessage ?? "Media upload completion aborted."
    this.rateLimitMessage = config.rateLimitMessage ?? "Too many media uploads are being completed."

    if (!Number.isInteger(this.maxConcurrent) || this.maxConcurrent < 1) {
      throw new MediaConfigurationError("maxConcurrent must be a positive integer.", {
        maxConcurrent: this.maxConcurrent,
      })
    }

    if (!Number.isInteger(this.maxQueued) || this.maxQueued < 0) {
      throw new MediaConfigurationError("maxQueued must be a non-negative integer.", {
        maxQueued: this.maxQueued,
      })
    }
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)

    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new MediaUploadAbortedError(this.abortMessage))
    }

    if (this.active < this.maxConcurrent) {
      this.active += 1
      return Promise.resolve()
    }

    if (this.queue.length >= this.maxQueued) {
      throw new MediaRateLimitError(this.rateLimitMessage, {
        maxConcurrent: this.maxConcurrent,
        maxQueued: this.maxQueued,
      })
    }

    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask = { resolve, reject, signal }

      if (signal) {
        queuedTask.abortHandler = () => {
          const index = this.queue.indexOf(queuedTask)

          if (index !== -1) {
            this.queue.splice(index, 1)
          }

          reject(new MediaUploadAbortedError(this.abortMessage))
        }

        signal.addEventListener("abort", queuedTask.abortHandler, { once: true })
      }

      this.queue.push(queuedTask)
    })
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)

    const next = this.queue.shift()
    if (!next) {
      return
    }

    if (next.signal && next.abortHandler) {
      next.signal.removeEventListener("abort", next.abortHandler)
    }

    if (next.signal?.aborted) {
      next.reject(new MediaUploadAbortedError(this.abortMessage))
      this.release()
      return
    }

    this.active += 1
    next.resolve()
  }
}

export function createInMemoryCompletionLimiter(
  config?: InMemoryCompletionLimiterConfig
): InMemoryCompletionLimiter {
  return new InMemoryCompletionLimiter(config)
}
