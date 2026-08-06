import { MediaConfigurationError } from "../domain/errors.js"
import type { MediaId } from "../domain/types.js"
import type { Clock } from "../ports/clock.js"
import { systemClock } from "../ports/clock.js"
import type { Logger } from "../ports/logger.js"
import { noopLogger } from "../ports/logger.js"
import type {
  MarkObjectDeletionFailure,
  ObjectDeletionOutbox,
  ObjectDeletionOutboxJob,
} from "../ports/object-deletion-outbox.js"
import type { ObjectStorageProvider } from "../ports/storage-provider.js"
import { throwIfAborted } from "./context.js"
import { truncateFailureReason } from "./validation.js"

export interface ProcessObjectDeletionOutboxInput<
  TAssetId extends MediaId = MediaId,
  TJobId extends MediaId = MediaId,
> {
  outbox: ObjectDeletionOutbox<TAssetId, TJobId>
  storage: ObjectStorageProvider
  clock?: Clock
  logger?: Logger
  limit?: number
  lockMs?: number
  retryDelayMs?: number
  maxAttempts?: number
  signal?: AbortSignal
}

export interface ProcessObjectDeletionOutboxResult {
  claimed: number
  deleted: number
  missing: number
  failed: number
  terminalFailed: number
  retried: number
}

interface DeleteOutcome {
  state: "deleted" | "missing" | "failed"
  error?: unknown
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new MediaConfigurationError(`${name} must be a positive integer.`, { [name]: value })
  }
}

function groupJobsByObjectKey<TAssetId extends MediaId, TJobId extends MediaId>(
  jobs: ObjectDeletionOutboxJob<TAssetId, TJobId>[]
): Map<string, ObjectDeletionOutboxJob<TAssetId, TJobId>[]> {
  const byKey = new Map<string, ObjectDeletionOutboxJob<TAssetId, TJobId>[]>()

  for (const job of jobs) {
    const existing = byKey.get(job.objectKey)
    if (existing) {
      existing.push(job)
    } else {
      byKey.set(job.objectKey, [job])
    }
  }

  return byKey
}

async function deleteOne(storage: ObjectStorageProvider, key: string): Promise<DeleteOutcome> {
  try {
    await storage.deleteObject(key)
    return { state: "deleted" }
  } catch (error) {
    if (storage.isObjectNotFoundError?.(error)) {
      return { state: "missing" }
    }

    return { state: "failed", error }
  }
}

async function deleteKeys(
  storage: ObjectStorageProvider,
  keys: string[]
): Promise<Map<string, DeleteOutcome>> {
  const outcomes = new Map<string, DeleteOutcome>()

  if (storage.deleteObjects) {
    try {
      const result = await storage.deleteObjects(keys)
      if (!result) {
        for (const key of keys) {
          outcomes.set(key, { state: "deleted" })
        }
        return outcomes
      }

      for (const key of result.deletedKeys) {
        outcomes.set(key, { state: "deleted" })
      }
      for (const key of result.missingKeys) {
        outcomes.set(key, { state: "missing" })
      }
      for (const failed of result.failedKeys) {
        outcomes.set(failed.key, { state: "failed", error: failed.error })
      }
    } catch {
      outcomes.clear()
    }
  }

  for (const key of keys) {
    if (!outcomes.has(key)) {
      outcomes.set(key, await deleteOne(storage, key))
    }
  }

  return outcomes
}

export async function processObjectDeletionOutbox<
  TAssetId extends MediaId = MediaId,
  TJobId extends MediaId = MediaId,
>(
  input: ProcessObjectDeletionOutboxInput<TAssetId, TJobId>
): Promise<ProcessObjectDeletionOutboxResult> {
  const clock = input.clock ?? systemClock
  const logger = input.logger ?? noopLogger
  const limit = input.limit ?? 100
  const lockMs = input.lockMs ?? 60_000
  const retryDelayMs = input.retryDelayMs ?? 60_000
  const maxAttempts = input.maxAttempts ?? 5

  assertPositiveInteger("limit", limit)
  assertPositiveInteger("lockMs", lockMs)
  assertPositiveInteger("retryDelayMs", retryDelayMs)
  assertPositiveInteger("maxAttempts", maxAttempts)
  throwIfAborted(input.signal)

  const now = clock.now()
  const jobs = await input.outbox.claimObjectDeletions({
    limit,
    now,
    lockUntil: new Date(now.getTime() + lockMs),
  })

  if (!jobs.length) {
    return { claimed: 0, deleted: 0, missing: 0, failed: 0, terminalFailed: 0, retried: 0 }
  }

  throwIfAborted(input.signal)
  const jobsByKey = groupJobsByObjectKey(jobs)
  const outcomes = await deleteKeys(input.storage, Array.from(jobsByKey.keys()))
  throwIfAborted(input.signal)

  const succeededIds: TJobId[] = []
  const failures: MarkObjectDeletionFailure<TJobId>[] = []
  let deleted = 0
  let missing = 0
  let terminalFailed = 0
  let retried = 0

  for (const [key, keyJobs] of jobsByKey) {
    const outcome = outcomes.get(key) ?? { state: "failed", error: "Delete outcome missing." }

    if (outcome.state === "deleted" || outcome.state === "missing") {
      if (outcome.state === "deleted") deleted += keyJobs.length
      if (outcome.state === "missing") missing += keyJobs.length
      succeededIds.push(...keyJobs.map((job) => job.id))
      continue
    }

    for (const job of keyJobs) {
      const terminal = job.attempts + 1 >= maxAttempts
      if (terminal) {
        terminalFailed += 1
      } else {
        retried += 1
      }

      failures.push({
        id: job.id,
        error: truncateFailureReason(outcome.error),
        retryAt: terminal ? null : new Date(now.getTime() + retryDelayMs),
        terminal,
      })
    }
  }

  if (succeededIds.length) {
    await input.outbox.markObjectDeletionsSucceeded({ ids: succeededIds, now: clock.now() })
  }

  if (failures.length) {
    await input.outbox.markObjectDeletionsFailed({ failures, now: clock.now() })
    for (const failure of failures) {
      logger.warn?.("Failed to delete media object from deletion outbox.", {
        jobId: failure.id,
        error: failure.error,
        terminal: failure.terminal,
      })
    }
  }

  return {
    claimed: jobs.length,
    deleted,
    missing,
    failed: failures.length,
    terminalFailed,
    retried,
  }
}
