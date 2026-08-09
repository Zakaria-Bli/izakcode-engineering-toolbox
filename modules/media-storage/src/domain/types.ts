import type { DefaultMediaAssetKind, MediaAssetStatus, MediaUploadSessionStatus } from "./states.js"

export type MediaId = string | number
export type MediaActorId = string | number
export type MediaProviderName = string
export type MediaAssetKind = DefaultMediaAssetKind | (string & {})
export type MediaVariantType = string
export type MediaImageFormat = "webp" | "jpeg" | "png" | "avif" | (string & {})
export type MediaDeletionMode = "tombstone" | "hard-delete"

export interface MediaAsset<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  id: TAssetId
  kind: TKind
  status: MediaAssetStatus
  provider: MediaProviderName
  bucket: string | null
  objectKey: string
  publicUrl: string | null
  originalFilename: string
  mimeType: string
  size: number
  checksum: string | null
  width: number | null
  height: number | null
  ownerId: TActorId | null
  failureReason: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  metadata?: Record<string, unknown> | null
}

export interface MediaAssetVariant<TAssetId extends MediaId = MediaId> {
  id: MediaId
  assetId: TAssetId
  variantType: MediaVariantType
  objectKey: string
  publicUrl: string | null
  width: number
  height: number
  format: MediaImageFormat
  size: number
  createdAt: Date
  metadata?: Record<string, unknown> | null
}

export interface MediaUploadSession<TAssetId extends MediaId = MediaId> {
  id: string
  assetId: TAssetId
  expectedMime: string
  expectedSize: number
  objectKey: string
  expiresAt: Date
  status: MediaUploadSessionStatus
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export interface MediaUploadRecord<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  asset: MediaAsset<TAssetId, TActorId, TKind>
  session: MediaUploadSession<TAssetId>
}

export interface MediaAssetWithVariants<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  asset: MediaAsset<TAssetId, TActorId, TKind>
  variants: MediaAssetVariant<TAssetId>[]
}

export interface StoredObjectMetadata {
  key: string
  contentType: string | null
  contentLength: number | null
  eTag: string | null
  lastModified?: Date | null
  metadata?: Record<string, string> | null
}

export interface ImageMetadata {
  width: number
  height: number
  format?: string | null
  size: number
}

export interface ImageVariantDefinition {
  name: MediaVariantType
  width: number
  height?: number
  quality: number
  format: MediaImageFormat
  fit?: "cover" | "inside" | "contain" | "fill" | "outside"
  withoutEnlargement?: boolean
}

export interface ProcessedImageVariant {
  variantType: MediaVariantType
  buffer: Buffer
  width: number
  height: number
  format: MediaImageFormat
  size: number
  metadata?: Record<string, unknown> | null
}

export interface PreparedMediaVariant {
  variantType: MediaVariantType
  objectKey: string
  publicUrl: string | null
  buffer: Buffer
  width: number
  height: number
  format: MediaImageFormat
  size: number
  metadata?: Record<string, unknown> | null
}

export interface UploadIntent<TAssetId extends MediaId = MediaId> {
  uploadUrl: string
  headers: Record<string, string>
  fields?: Record<string, string>
  sessionId: string
  assetId: TAssetId
  objectKey: string
  expiresAt: Date
}

export type CompleteUploadResult<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> = MediaAssetWithVariants<TAssetId, TActorId, TKind>

export interface CreateUploadIntentInput<
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  filename: string
  mimeType: string
  size: number
  kind: TKind
  actorId?: TActorId | null
  pathPrefix?: string | null
  metadata?: Record<string, unknown> | null
}

export interface CompleteUploadInput<TActorId extends MediaActorId = MediaActorId> {
  sessionId: string
  actorId?: TActorId | null
  checksum?: string | null
  signal?: AbortSignal
}

export interface CancelUploadInput<TActorId extends MediaActorId = MediaActorId> {
  sessionId: string
  actorId?: TActorId | null
}

export interface GetAssetInput<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
> {
  assetId: TAssetId
  actorId?: TActorId | null
}

export interface ListAssetsInput<
  TActorId extends MediaActorId = MediaActorId,
> extends ListAssetsFilters {
  actorId?: TActorId | null
}

export interface GetDownloadUrlInput<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
> {
  assetId: TAssetId
  actorId?: TActorId | null
  variantType?: MediaVariantType | null
  expiresInSeconds?: number
  responseContentDisposition?: string
  preferSignedUrl?: boolean
}

export interface DownloadUrlResult {
  url: string
  objectKey: string
  publicUrl: string | null
  expiresAt: Date | null
  contentType: string | null
}

export interface DeleteAssetInput<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
> {
  assetId: TAssetId
  actorId?: TActorId | null
}

export interface MoveAssetsInput<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
> {
  assetIds: TAssetId[]
  toPrefix: string
  actorId?: TActorId | null
}

export interface MovedMediaVariant {
  variantId: MediaId
  objectKey: string
  publicUrl: string | null
}

export interface MovedMediaAsset<TAssetId extends MediaId = MediaId> {
  assetId: TAssetId
  objectKey: string
  publicUrl: string | null
  variants: MovedMediaVariant[]
}

export interface MoveAssetsResult<TAssetId extends MediaId = MediaId> {
  assets: MovedMediaAsset<TAssetId>[]
}

export interface CleanupMediaInput {
  limit?: number
}

export interface CleanupPlanItem<TAssetId extends MediaId = MediaId> {
  assetId: TAssetId
  sessionId?: string | null
  reason: "expired_session" | "stale_asset" | "orphan_asset" | "temporary_asset"
  objectKeys: string[]
}

export interface CleanupPlan<TAssetId extends MediaId = MediaId> {
  cutoff: Date
  items: CleanupPlanItem<TAssetId>[]
  objectKeys: string[]
  assetIds: TAssetId[]
  sessionIds: string[]
  skippedAssetIds: TAssetId[]
}

export interface CleanupResult<TAssetId extends MediaId = MediaId> {
  plan: CleanupPlan<TAssetId>
  deletedObjects: number
  missingObjects: number
  failedObjects: number
  deletedAssets: number
  expiredSessions: number
  skippedAssets: number
}

export interface ListAssetsFilters {
  page?: number
  pageSize?: number
  status?: MediaAssetStatus
  kind?: string
  search?: string
}

export interface Page<TItem> {
  items: TItem[]
  total: number
  page: number
  pageSize: number
}
