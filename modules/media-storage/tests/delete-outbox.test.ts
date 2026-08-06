import { describe, expect, it, vi } from "vitest"

import {
  type ObjectDeletionOutbox,
  type ObjectDeletionOutboxJob,
  type ObjectStorageProvider,
  processObjectDeletionOutbox,
} from "../index.js"

class MemoryDeletionOutbox implements ObjectDeletionOutbox<string, string> {
  jobs: ObjectDeletionOutboxJob<string, string>[]
  claimInputs: unknown[] = []
  succeededIds: string[] = []
  failures: { id: string; error: string; retryAt: Date | null; terminal: boolean }[] = []

  constructor(jobs: ObjectDeletionOutboxJob<string, string>[]) {
    this.jobs = jobs
  }

  async enqueueObjectDeletions(): Promise<void> {
    // enqueue behavior belongs to app repository tests.
  }

  async claimObjectDeletions(input: {
    limit: number
    now: Date
    lockUntil: Date
  }): Promise<ObjectDeletionOutboxJob<string, string>[]> {
    this.claimInputs.push(input)
    return this.jobs.slice(0, input.limit)
  }

  async markObjectDeletionsSucceeded(input: { ids: string[] }): Promise<void> {
    this.succeededIds.push(...input.ids)
  }

  async markObjectDeletionsFailed(input: {
    failures: { id: string; error: string; retryAt: Date | null; terminal: boolean }[]
  }): Promise<void> {
    this.failures.push(...input.failures)
  }
}

function createJob(
  input: Partial<ObjectDeletionOutboxJob<string, string>> & { id: string; objectKey: string }
) {
  return {
    reason: "asset_deleted",
    assetId: "asset-1",
    sessionId: null,
    attempts: 0,
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...input,
  } satisfies ObjectDeletionOutboxJob<string, string>
}

function createStorage(overrides: Partial<ObjectStorageProvider> = {}): ObjectStorageProvider {
  return {
    name: "test",
    async headObject() {
      return null
    },
    async getObjectBuffer() {
      return Buffer.alloc(0)
    },
    async putObject() {
      // no-op
    },
    async deleteObject() {
      // no-op
    },
    ...overrides,
  }
}

describe("processObjectDeletionOutbox", () => {
  it("uses batch delete results to mark outbox jobs succeeded or failed", async () => {
    const now = new Date("2026-02-03T04:05:06.000Z")
    const outbox = new MemoryDeletionOutbox([
      createJob({ id: "job-1", objectKey: "uploads/a.jpg" }),
      createJob({ id: "job-2", objectKey: "uploads/b.jpg", attempts: 4 }),
      createJob({ id: "job-3", objectKey: "uploads/c.jpg" }),
      createJob({ id: "job-4", objectKey: "uploads/a.jpg" }),
    ])
    const storage = createStorage({
      async deleteObjects(keys) {
        expect(keys).toEqual(["uploads/a.jpg", "uploads/b.jpg", "uploads/c.jpg"])
        return {
          deletedKeys: ["uploads/a.jpg"],
          missingKeys: ["uploads/c.jpg"],
          failedKeys: [{ key: "uploads/b.jpg", error: new Error("boom") }],
        }
      },
    })

    const result = await processObjectDeletionOutbox({
      outbox,
      storage,
      clock: { now: () => now },
      limit: 10,
      lockMs: 30_000,
      maxAttempts: 5,
    })

    expect(outbox.claimInputs).toEqual([
      { limit: 10, now, lockUntil: new Date("2026-02-03T04:05:36.000Z") },
    ])
    expect(outbox.succeededIds.sort()).toEqual(["job-1", "job-3", "job-4"])
    expect(outbox.failures).toEqual([{ id: "job-2", error: "boom", retryAt: null, terminal: true }])
    expect(result).toEqual({
      claimed: 4,
      deleted: 2,
      missing: 1,
      failed: 1,
      terminalFailed: 1,
      retried: 0,
    })
  })

  it("falls back to individual deletes for failed batch deletes", async () => {
    const now = new Date("2026-02-03T04:05:06.000Z")
    const outbox = new MemoryDeletionOutbox([
      createJob({ id: "job-1", objectKey: "uploads/a.jpg" }),
      createJob({ id: "job-2", objectKey: "uploads/b.jpg" }),
      createJob({ id: "job-3", objectKey: "uploads/c.jpg" }),
    ])
    const deletedKeys: string[] = []
    const storage = createStorage({
      async deleteObjects() {
        throw new Error("batch unavailable")
      },
      async deleteObject(key) {
        deletedKeys.push(key)
        if (key === "uploads/b.jpg") {
          const error = new Error("missing")
          error.name = "NotFound"
          throw error
        }
        if (key === "uploads/c.jpg") {
          throw new Error("temporary failure")
        }
      },
      isObjectNotFoundError(error) {
        return error instanceof Error && error.name === "NotFound"
      },
    })
    const logger = { warn: vi.fn() }

    const result = await processObjectDeletionOutbox({
      outbox,
      storage,
      clock: { now: () => now },
      logger,
      retryDelayMs: 5_000,
      maxAttempts: 3,
    })

    expect(deletedKeys).toEqual(["uploads/a.jpg", "uploads/b.jpg", "uploads/c.jpg"])
    expect(outbox.succeededIds.sort()).toEqual(["job-1", "job-2"])
    expect(outbox.failures).toEqual([
      {
        id: "job-3",
        error: "temporary failure",
        retryAt: new Date("2026-02-03T04:05:11.000Z"),
        terminal: false,
      },
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to delete media object from deletion outbox.",
      expect.objectContaining({ jobId: "job-3", terminal: false })
    )
    expect(result).toEqual({
      claimed: 3,
      deleted: 1,
      missing: 1,
      failed: 1,
      terminalFailed: 0,
      retried: 1,
    })
  })

  it("returns zero counts when no jobs are claimed", async () => {
    const result = await processObjectDeletionOutbox({
      outbox: new MemoryDeletionOutbox([]),
      storage: createStorage(),
      clock: { now: () => new Date("2026-02-03T04:05:06.000Z") },
    })

    expect(result).toEqual({
      claimed: 0,
      deleted: 0,
      missing: 0,
      failed: 0,
      terminalFailed: 0,
      retried: 0,
    })
  })
})
