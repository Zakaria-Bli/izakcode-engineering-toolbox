import type { MediaId } from "../domain/types.js"

export type MediaObjectDeletionReason =
  | "asset_deleted"
  | "upload_cancelled"
  | "upload_failed"
  | "cleanup"
  | "move_source"
  | "move_rollback"
  | "variant_cleanup"
  | (string & {})

export interface EnqueueObjectDeletionRequest<TAssetId extends MediaId = MediaId> {
  objectKey: string
  reason: MediaObjectDeletionReason
  assetId?: TAssetId | null
  sessionId?: string | null
  requestedAt: Date
  context?: Record<string, unknown> | null
}

export interface EnqueueObjectDeletionsInput<TAssetId extends MediaId = MediaId> {
  requests: EnqueueObjectDeletionRequest<TAssetId>[]
}

export interface ObjectDeletionOutboxJob<
  TAssetId extends MediaId = MediaId,
  TJobId extends MediaId = MediaId,
> {
  id: TJobId
  objectKey: string
  reason: MediaObjectDeletionReason
  assetId?: TAssetId | null
  sessionId?: string | null
  attempts: number
  requestedAt: Date
  lockedUntil?: Date | null
  lastError?: string | null
  context?: Record<string, unknown> | null
}

export interface ClaimObjectDeletionsInput {
  limit: number
  now: Date
  lockUntil: Date
}

export interface MarkObjectDeletionsSucceededInput<TJobId extends MediaId = MediaId> {
  ids: TJobId[]
  now: Date
}

export interface MarkObjectDeletionFailure<TJobId extends MediaId = MediaId> {
  id: TJobId
  error: string
  retryAt: Date | null
  terminal: boolean
}

export interface MarkObjectDeletionsFailedInput<TJobId extends MediaId = MediaId> {
  failures: MarkObjectDeletionFailure<TJobId>[]
  now: Date
}

/**
 * Durable object-deletion outbox for apps that need retriable storage cleanup.
 *
 * Implement this with the same database as `MediaRepository` when possible. Repository methods
 * that change media rows to deleted/failed/moved can enqueue deletion requests in the same DB
 * transaction, while a worker later claims jobs and deletes storage objects.
 */
export interface ObjectDeletionOutbox<
  TAssetId extends MediaId = MediaId,
  TJobId extends MediaId = MediaId,
> {
  enqueueObjectDeletions(input: EnqueueObjectDeletionsInput<TAssetId>): Promise<void>

  claimObjectDeletions(
    input: ClaimObjectDeletionsInput
  ): Promise<ObjectDeletionOutboxJob<TAssetId, TJobId>[]>

  markObjectDeletionsSucceeded(input: MarkObjectDeletionsSucceededInput<TJobId>): Promise<void>

  markObjectDeletionsFailed(input: MarkObjectDeletionsFailedInput<TJobId>): Promise<void>
}
