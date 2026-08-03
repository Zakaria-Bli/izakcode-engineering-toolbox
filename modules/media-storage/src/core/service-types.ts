import type {
  CancelUploadInput,
  CleanupMediaInput,
  CleanupPlan,
  CleanupResult,
  CompleteUploadInput,
  CompleteUploadResult,
  CreateUploadIntentInput,
  DeleteAssetInput,
  DownloadUrlResult,
  GetAssetInput,
  GetDownloadUrlInput,
  ListAssetsInput,
  MediaActorId,
  MediaAsset,
  MediaAssetKind,
  MediaAssetWithVariants,
  MediaId,
  MediaUploadRecord,
  MoveAssetsInput,
  MoveAssetsResult,
  Page,
  UploadIntent,
} from "../domain/types.js"
import type { Clock } from "../ports/clock.js"
import type { ContentInspector } from "../ports/content-inspector.js"
import type { IdGenerator } from "../ports/id-generator.js"
import type { ImageProcessor } from "../ports/image-processor.js"
import type { ObjectKeyStrategy } from "../ports/key-strategy.js"
import type { CompletionLimiter } from "../ports/limiter.js"
import type { Logger } from "../ports/logger.js"
import type { MediaAssetUsagePolicy, MediaRepository } from "../ports/media-repository.js"
import type { ObjectStorageProvider } from "../ports/storage-provider.js"
import type { MediaStoragePolicies } from "./policies.js"

export interface MediaStorageRetryDecisionInput {
  error: unknown
  attempt: number
  operation: string
}

export interface MediaStorageRetryPolicy {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  shouldRetry?(input: MediaStorageRetryDecisionInput): boolean
}

/**
 * Optional app authorization hooks used by core workflows after the adapter identifies an actor.
 * Throw a domain/app error to deny. Hooks should be side-effect-free.
 */
export interface MediaStorageActorPolicy<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  assertCanCreateUpload?(input: {
    actorId?: TActorId | null
    input: CreateUploadIntentInput<TActorId, TKind>
  }): Promise<void> | void
  assertCanCompleteUpload?(input: {
    actorId?: TActorId | null
    record: MediaUploadRecord<TAssetId, TActorId, TKind>
  }): Promise<void> | void
  assertCanCancelUpload?(input: {
    actorId?: TActorId | null
    record: MediaUploadRecord<TAssetId, TActorId, TKind>
  }): Promise<void> | void
  assertCanDeleteAsset?(input: {
    actorId?: TActorId | null
    assetWithVariants: MediaAssetWithVariants<TAssetId, TActorId, TKind>
  }): Promise<void> | void
  assertCanReadAsset?(input: {
    actorId?: TActorId | null
    assetWithVariants: MediaAssetWithVariants<TAssetId, TActorId, TKind>
  }): Promise<void> | void
  assertCanListAssets?(input: {
    actorId?: TActorId | null
    filters: ListAssetsInput<TActorId>
  }): Promise<void> | void
  assertCanMoveAsset?(input: {
    actorId?: TActorId | null
    assetWithVariants: MediaAssetWithVariants<TAssetId, TActorId, TKind>
    toPrefix: string
  }): Promise<void> | void
}

/** Stable factory configuration for `createMediaStorage()`. */
export interface MediaStorageConfig<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  repository: MediaRepository<TAssetId, TActorId, TKind>
  storage: ObjectStorageProvider
  imageProcessor?: ImageProcessor
  contentInspector?: ContentInspector<TKind>
  keyStrategy: ObjectKeyStrategy<TAssetId>
  idGenerator: IdGenerator<TAssetId>
  policies?: Partial<MediaStoragePolicies<TKind>>
  clock?: Clock
  limiter?: CompletionLimiter
  logger?: Logger
  retryPolicy?: MediaStorageRetryPolicy
  actorPolicy?: MediaStorageActorPolicy<TAssetId, TActorId, TKind>
  assetUsagePolicy?: MediaAssetUsagePolicy<TAssetId, TActorId, TKind>
}

/** Stable framework-agnostic service API exposed by `createMediaStorage()`. */
export interface MediaStorageService<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  /** Create an upload session and direct-upload target for a validated object. */
  createUploadIntent(
    input: CreateUploadIntentInput<TActorId, TKind>
  ): Promise<UploadIntent<TAssetId>>
  /** Claim, validate, inspect, process, and persist a completed direct upload. */
  completeUpload(
    input: CompleteUploadInput<TActorId>
  ): Promise<CompleteUploadResult<TAssetId, TActorId, TKind>>
  /** Cancel an awaiting upload and best-effort delete its object. */
  cancelUpload(input: CancelUploadInput<TActorId>): Promise<void>
  /** Read one non-deleted asset with variants through read authorization hooks. */
  getAsset(
    input: GetAssetInput<TAssetId, TActorId>
  ): Promise<MediaAssetWithVariants<TAssetId, TActorId, TKind>>
  /** List assets through list authorization hooks. */
  listAssets(
    input?: ListAssetsInput<TActorId>
  ): Promise<Page<MediaAsset<TAssetId, TActorId, TKind>>>
  /** Return a public or signed download URL for an asset or variant. */
  getDownloadUrl(input: GetDownloadUrlInput<TAssetId, TActorId>): Promise<DownloadUrlResult>
  /** Mark an asset deleted and best-effort delete all associated objects. */
  deleteAsset(input: DeleteAssetInput<TAssetId, TActorId>): Promise<void>
  /** Copy objects to a new prefix, transactionally update keys, then delete sources. */
  moveAssets(input: MoveAssetsInput<TAssetId, TActorId>): Promise<MoveAssetsResult<TAssetId>>
  /** Build a cleanup plan without mutating storage or persistence. */
  planCleanup(input?: CleanupMediaInput): Promise<CleanupPlan<TAssetId>>
  /** Execute cleanup by deleting objects first, then marking records cleaned/deleted. */
  cleanup(input?: CleanupMediaInput): Promise<CleanupResult<TAssetId>>
}
