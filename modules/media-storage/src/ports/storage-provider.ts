import type { StoredObjectMetadata } from "../domain/types.js"

/** Input for legacy PUT-style presigned uploads. Prefer `CreateUploadTargetInput` for new providers. */
export interface CreatePresignedPutUrlInput {
  key: string
  contentType: string
  contentLength: number
  expiresInSeconds: number
  metadata?: Record<string, string>
}

export interface PresignedPutUrlResult {
  uploadUrl: string
  headers: Record<string, string>
  fields?: Record<string, string>
}

/** Provider-neutral direct upload target request. Supports PUT today and leaves room for POST/SAS-style providers. */
export interface CreateUploadTargetInput extends CreatePresignedPutUrlInput {
  method?: "PUT" | "POST"
}

/** Direct upload target returned to clients. `fields` is used by POST-like providers. */
export interface UploadTargetResult extends PresignedPutUrlResult {
  method: "PUT" | "POST"
}

export interface CreatePresignedGetUrlInput {
  key: string
  expiresInSeconds: number
  responseContentType?: string
  responseContentDisposition?: string
}

export interface PutObjectInput {
  key: string
  body: Buffer
  contentType: string
  metadata?: Record<string, string>
  signal?: AbortSignal
}

export interface PutObjectStreamInput {
  key: string
  body: AsyncIterable<Uint8Array>
  contentType: string
  contentLength?: number
  metadata?: Record<string, string>
  signal?: AbortSignal
}

export interface GetObjectStreamInput {
  key: string
  signal?: AbortSignal
}

export interface GetObjectStreamResult {
  body: AsyncIterable<Uint8Array>
  metadata: StoredObjectMetadata
}

export interface CopyObjectInput {
  fromKey: string
  toKey: string
  contentType?: string
  metadata?: Record<string, string>
  signal?: AbortSignal
}

export interface CreateMultipartUploadInput {
  key: string
  contentType: string
  metadata?: Record<string, string>
}

export interface CreateMultipartUploadResult {
  uploadId: string
  key: string
}

export interface CreateMultipartPartUrlInput {
  key: string
  uploadId: string
  partNumber: number
  expiresInSeconds: number
}

export interface MultipartUploadPart {
  partNumber: number
  eTag: string
}

export interface CompleteMultipartUploadInput {
  key: string
  uploadId: string
  parts: MultipartUploadPart[]
}

export interface AbortMultipartUploadInput {
  key: string
  uploadId: string
}

export interface DeleteObjectsResult {
  deletedKeys: string[]
  missingKeys: string[]
  failedKeys: { key: string; error: unknown }[]
}

/** Declared optional capabilities. Experimental capabilities may change before 1.0. */
export interface StorageProviderCapabilities {
  presignPut?: boolean
  uploadTarget?: boolean
  presignGet?: boolean
  publicUrl?: boolean
  copy?: boolean
  batchDelete?: boolean
  streamingRead?: boolean
  streamingWrite?: boolean
  multipart?: boolean
  exactUploadSize?: boolean
}

/**
 * Stable object-storage port implemented by storage adapters.
 *
 * Providers own object operations only. They must not mutate repositories, authorize actors,
 * process images, or run upload-session state transitions.
 */
export interface ObjectStorageProvider {
  /** Stable provider name stored on assets for audit/debugging. */
  name: string
  /** Logical bucket/container name when the provider has one. */
  bucket?: string | null
  /** Optional capability declaration used for fail-fast composition and docs. */
  capabilities?: StorageProviderCapabilities
  /** @deprecated Prefer `createUploadTarget()` for new providers. */
  createPresignedPutUrl?(input: CreatePresignedPutUrlInput): Promise<PresignedPutUrlResult>
  /** Create a client-facing direct upload target. Stable for PUT; POST/SAS shapes are experimental. */
  createUploadTarget?(input: CreateUploadTargetInput): Promise<UploadTargetResult>
  /** Create a short-lived read URL for private objects. */
  createPresignedGetUrl?(input: CreatePresignedGetUrlInput): Promise<string>
  /** Return object metadata, or `null` when the object is not found. */
  headObject(key: string, signal?: AbortSignal): Promise<StoredObjectMetadata | null>
  /** Buffer fallback for bounded-size completion. Stream-first providers should also implement `getObjectStream()`. */
  getObjectBuffer(key: string, signal?: AbortSignal): Promise<Buffer>
  /** Experimental stream-first read capability for large-object completion. */
  getObjectStream?(input: GetObjectStreamInput): Promise<GetObjectStreamResult>
  /** Trusted server-side object write, used for generated variants and server-managed objects. */
  putObject(input: PutObjectInput): Promise<void>
  /** Experimental stream-first server-side object write capability. */
  putObjectStream?(input: PutObjectStreamInput): Promise<void>
  /** Copy an object within the provider. Required by `moveAssets()`. */
  copyObject?(input: CopyObjectInput): Promise<void>
  /** Delete one object. Not-found errors should be recognizable via `isObjectNotFoundError()`. */
  deleteObject(key: string): Promise<void>
  /** Batch delete objects when supported; return partial failure/missing details. */
  deleteObjects?(keys: string[]): Promise<DeleteObjectsResult | undefined>
  /** Return a durable public URL when the provider/CDN supports public objects. */
  getPublicUrl?(key: string): string
  /** Parse provider-generated public URLs back to object keys when possible. */
  parsePublicUrl?(url: string): string | null
  /** Classify provider-specific not-found errors. */
  isObjectNotFoundError?(error: unknown): boolean
  /** Experimental multipart/resumable upload capabilities. */
  createMultipartUpload?(input: CreateMultipartUploadInput): Promise<CreateMultipartUploadResult>
  /** Experimental multipart part upload URL generation. */
  createMultipartPartUrl?(input: CreateMultipartPartUrlInput): Promise<PresignedPutUrlResult>
  /** Experimental multipart completion. */
  completeMultipartUpload?(input: CompleteMultipartUploadInput): Promise<void>
  /** Experimental multipart abort. */
  abortMultipartUpload?(input: AbortMultipartUploadInput): Promise<void>
}
