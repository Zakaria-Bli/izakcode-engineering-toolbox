import type {
  CompleteUploadResult,
  ListAssetsFilters,
  MediaActorId,
  MediaAsset,
  MediaAssetKind,
  MediaAssetWithVariants,
  MediaDeletionMode,
  MediaId,
  MediaUploadRecord,
  Page,
} from "../domain/types.js"
import type { EnqueueObjectDeletionsInput } from "./object-deletion-outbox.js"

export interface CreatePendingUploadRepositoryInput<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  assetId?: TAssetId | null
  sessionId: string
  kind: TKind
  provider: string
  bucket: string | null
  objectKey: string
  publicUrl: string | null
  originalFilename: string
  mimeType: string
  size: number
  ownerId: TActorId | null
  expiresAt: Date
  now: Date
  metadata?: Record<string, unknown> | null
}

export interface ClaimUploadForProcessingInput<TAssetId extends MediaId = MediaId> {
  sessionId: string
  assetId: TAssetId
  now: Date
}

export interface PersistCompletedVariantInput {
  variantType: string
  objectKey: string
  publicUrl: string | null
  width: number
  height: number
  format: string
  size: number
  metadata?: Record<string, unknown> | null
}

export interface CompleteUploadRepositoryInput<TAssetId extends MediaId = MediaId> {
  sessionId: string
  assetId: TAssetId
  publicUrl: string | null
  checksum: string
  width: number | null
  height: number | null
  variants: PersistCompletedVariantInput[]
  now: Date
}

export interface FailUploadRepositoryInput<TAssetId extends MediaId = MediaId> {
  sessionId: string
  assetId: TAssetId
  failureReason: string
  now: Date
}

export interface ReleaseUploadClaimRepositoryInput<TAssetId extends MediaId = MediaId> {
  sessionId: string
  assetId: TAssetId
  now: Date
}

export interface ExpireUploadRepositoryInput<TAssetId extends MediaId = MediaId> {
  sessionId: string
  assetId: TAssetId
  failureReason: string
  now: Date
}

export interface CancelUploadRepositoryInput<TAssetId extends MediaId = MediaId> {
  sessionId: string
  assetId: TAssetId
  deletionMode: MediaDeletionMode
  now: Date
}

export interface MarkAssetDeletedInput<TAssetId extends MediaId = MediaId> {
  assetId: TAssetId
  deletionMode: MediaDeletionMode
  now: Date
}

export interface MarkAssetsDeletedInput<TAssetId extends MediaId = MediaId> {
  assetIds: TAssetId[]
  deletionMode: MediaDeletionMode
  now: Date
}

export interface UpdateAssetObjectKeysInput<TAssetId extends MediaId = MediaId> {
  assetId: TAssetId
  objectKey: string
  publicUrl: string | null
  variants: {
    variantId: MediaId
    objectKey: string
    publicUrl: string | null
  }[]
  now: Date
}

export interface UpdateAssetObjectKeysBatchInput<TAssetId extends MediaId = MediaId> {
  updates: UpdateAssetObjectKeysInput<TAssetId>[]
}

export interface CleanupQuery {
  now: Date
  cutoff: Date
  limit: number
}

export interface CleanupCandidate<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> extends MediaAssetWithVariants<TAssetId, TActorId, TKind> {
  reason: "expired_session" | "stale_asset" | "orphan_asset" | "temporary_asset"
  sessionId?: string | null
}

/**
 * Stable persistence port implemented by applications.
 *
 * The repository owns assets, variants, and upload sessions only. It must not call storage
 * providers, authorize actors, or process images. State-transition methods should be atomic
 * or transactional as documented in `PUBLIC-CONTRACTS.md`.
 */
export interface MediaRepository<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  /**
   * Run a task with a transaction-bound repository.
   *
   * Callbacks must use the repository argument, not a repository captured from an outer closure.
   */
  transaction?<T>(
    task: (repository: MediaRepository<TAssetId, TActorId, TKind>) => Promise<T>
  ): Promise<T>

  /** Create an asset and upload session in awaiting/pending state. */
  createPendingUpload(
    input: CreatePendingUploadRepositoryInput<TAssetId, TActorId, TKind>
  ): Promise<MediaUploadRecord<TAssetId, TActorId, TKind>>

  /** Load an upload session with its asset for lifecycle checks. */
  findUploadSessionWithAsset(
    sessionId: string
  ): Promise<MediaUploadRecord<TAssetId, TActorId, TKind> | null>

  /** Atomically claim an awaiting upload for processing; return false if already claimed/invalid. */
  claimUploadForProcessing(input: ClaimUploadForProcessingInput<TAssetId>): Promise<boolean>

  /** Transactionally mark upload complete, persist asset metadata, persist variants, and complete session. */
  completeUpload(
    input: CompleteUploadRepositoryInput<TAssetId>
  ): Promise<CompleteUploadResult<TAssetId, TActorId, TKind>>

  /** Mark an upload terminally failed after non-retryable completion failure. */
  failUpload(input: FailUploadRepositoryInput<TAssetId>): Promise<void>

  /** Restore processing rows to retryable awaiting/pending state after retryable failures. */
  releaseUploadClaim?(input: ReleaseUploadClaimRepositoryInput<TAssetId>): Promise<void>

  /** Mark an awaiting upload expired. */
  expireUpload(input: ExpireUploadRepositoryInput<TAssetId>): Promise<void>

  cancelUpload(input: CancelUploadRepositoryInput<TAssetId>): Promise<void>

  findAssetWithVariants(
    assetId: TAssetId
  ): Promise<MediaAssetWithVariants<TAssetId, TActorId, TKind> | null>

  findAssetsWithVariants(
    assetIds: TAssetId[]
  ): Promise<MediaAssetWithVariants<TAssetId, TActorId, TKind>[]>

  listAssets(filters: ListAssetsFilters): Promise<Page<MediaAsset<TAssetId, TActorId, TKind>>>

  markAssetDeleted(input: MarkAssetDeletedInput<TAssetId>): Promise<void>

  /** Batch mark assets deleted for cleanup-heavy paths; core falls back to `markAssetDeleted`. */
  markAssetsDeleted?(input: MarkAssetsDeletedInput<TAssetId>): Promise<void>

  updateAssetObjectKeys(input: UpdateAssetObjectKeysInput<TAssetId>): Promise<void>

  /** Batch update moved object keys; core falls back to `updateAssetObjectKeys`. */
  updateAssetObjectKeysBatch?(input: UpdateAssetObjectKeysBatchInput<TAssetId>): Promise<void>

  /** Find assets/sessions eligible for cleanup after app-specific retention and state rules. */
  findCleanupCandidates(query: CleanupQuery): Promise<CleanupCandidate<TAssetId, TActorId, TKind>[]>

  /** Batch mark upload sessions expired after their objects were cleaned. */
  markUploadSessionsExpired(sessionIds: string[], now: Date): Promise<void>

  /**
   * Optional durable object-deletion enqueue hook.
   *
   * When `policies.objectDeletionMode` is `"outbox"`, core calls this from the
   * same repository transaction as the related state transition. Implementations
   * should write rows consumed by `processObjectDeletionOutbox()`.
   */
  enqueueObjectDeletions?(input: EnqueueObjectDeletionsInput<TAssetId>): Promise<void>
}

export type MediaAssetUsagePolicy<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> = (input: {
  asset: MediaAsset<TAssetId, TActorId, TKind>
  actorId?: TActorId | null
}) =>
  | Promise<{ inUse: boolean; details?: Record<string, unknown> }>
  | { inUse: boolean; details?: Record<string, unknown> }
