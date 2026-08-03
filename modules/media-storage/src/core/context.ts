import {
  CapabilityNotSupportedError,
  InvalidMediaRequestError,
  isMediaStorageError,
  MediaConfigurationError,
  MediaUploadAbortedError,
} from "../domain/errors.js"
import { DefaultMediaAssetKind } from "../domain/states.js"
import type { MediaActorId, MediaAssetKind, MediaId } from "../domain/types.js"
import { systemClock } from "../ports/clock.js"
import type { Logger } from "../ports/logger.js"
import { noopLogger } from "../ports/logger.js"
import type { MediaRepository } from "../ports/media-repository.js"
import type {
  EnqueueObjectDeletionRequest,
  MediaObjectDeletionReason,
} from "../ports/object-deletion-outbox.js"
import type { DeleteObjectsResult } from "../ports/storage-provider.js"
import type { MediaStoragePolicies } from "./policies.js"
import { mergeMediaStoragePolicies } from "./policies.js"
import type { MediaStorageConfig, MediaStorageRetryPolicy } from "./service-types.js"
import { validateMediaStoragePolicies } from "./validation.js"

export interface UploadTargetRequest {
  key: string
  contentType: string
  contentLength: number
  expiresInSeconds: number
}

export interface UploadTargetResponse {
  uploadUrl: string
  headers: Record<string, string>
  fields?: Record<string, string>
}

export interface CleanupDeleteSets {
  deletedKeys: Set<string>
  missingKeys: Set<string>
  failedKeys: Set<string>
}

export interface MediaStorageContext<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  config: MediaStorageConfig<TAssetId, TActorId, TKind>
  clock: NonNullable<MediaStorageConfig<TAssetId, TActorId, TKind>["clock"]>
  logger: Logger
  policies: MediaStoragePolicies<TKind>
  shouldProcessAsImage(kind: string): boolean
  getConfiguredPublicUrl(key: string): string | null
  assertStorageSupportsUploads(): void
  createUploadTarget(input: UploadTargetRequest): Promise<UploadTargetResponse>
  retry<T>(
    operation: string,
    task: () => Promise<T>,
    options?: { signal?: AbortSignal }
  ): Promise<T>
  deleteObjectBestEffort(
    key: string,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void>
  deleteObjectsBestEffort(
    keys: string[],
    message: string,
    context?: Record<string, unknown>
  ): Promise<void>
  createObjectDeletionRequests(input: {
    keys: string[]
    reason: MediaObjectDeletionReason
    assetId?: TAssetId | null
    sessionId?: string | null
    context?: Record<string, unknown> | null
  }): EnqueueObjectDeletionRequest<TAssetId>[]
  enqueueObjectDeletions(
    repository: MediaRepository<TAssetId, TActorId, TKind>,
    requests: EnqueueObjectDeletionRequest<TAssetId>[]
  ): Promise<boolean>
  deleteUploadedVariantsBestEffort(keys: string[]): Promise<void>
  deleteObjectsForCleanup(keys: string[], sets: CleanupDeleteSets): Promise<void>
}

export function getImageContentType(format: string): string {
  const normalized = format.trim().toLowerCase()

  switch (normalized) {
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "webp":
      return "image/webp"
    case "avif":
      return "image/avif"
    case "gif":
      return "image/gif"
    default:
      throw new InvalidMediaRequestError("Unsupported output image format.", { format })
  }
}

export function buildDefaultMovedObjectKey(
  toPrefix: string,
  assetId: MediaId,
  oldKey: string
): string {
  const filename = oldKey.split("/").pop()

  if (!filename) {
    throw new InvalidMediaRequestError("Cannot move media object without a filename.", { oldKey })
  }

  return `${toPrefix}/${String(assetId)}/${filename}`
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MediaUploadAbortedError()
  }
}

function defaultIsImageKind(kind: string): boolean {
  return kind === DefaultMediaAssetKind.IMAGE
}

interface ResolvedRetryPolicy {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  shouldRetry?: NonNullable<MediaStorageRetryPolicy["shouldRetry"]>
}

function resolveRetryPolicy(config: {
  retryPolicy?: MediaStorageRetryPolicy
}): ResolvedRetryPolicy {
  const policy = config.retryPolicy ?? {}
  const resolved = {
    maxAttempts: policy.maxAttempts ?? 1,
    initialDelayMs: policy.initialDelayMs ?? 200,
    maxDelayMs: policy.maxDelayMs ?? 2_000,
    backoffMultiplier: policy.backoffMultiplier ?? 2,
    shouldRetry: policy.shouldRetry,
  }

  if (!Number.isInteger(resolved.maxAttempts) || resolved.maxAttempts < 1) {
    throw new MediaConfigurationError("retryPolicy.maxAttempts must be a positive integer.", {
      maxAttempts: resolved.maxAttempts,
    })
  }

  if (!Number.isFinite(resolved.initialDelayMs) || resolved.initialDelayMs < 0) {
    throw new MediaConfigurationError("retryPolicy.initialDelayMs must be non-negative.", {
      initialDelayMs: resolved.initialDelayMs,
    })
  }

  if (!Number.isFinite(resolved.maxDelayMs) || resolved.maxDelayMs < 0) {
    throw new MediaConfigurationError("retryPolicy.maxDelayMs must be non-negative.", {
      maxDelayMs: resolved.maxDelayMs,
    })
  }

  if (!Number.isFinite(resolved.backoffMultiplier) || resolved.backoffMultiplier < 1) {
    throw new MediaConfigurationError("retryPolicy.backoffMultiplier must be at least 1.", {
      backoffMultiplier: resolved.backoffMultiplier,
    })
  }

  return resolved
}

function shouldRetryError(
  retryPolicy: ResolvedRetryPolicy,
  input: { error: unknown; attempt: number; operation: string }
): boolean {
  if (retryPolicy.shouldRetry) {
    return retryPolicy.shouldRetry(input)
  }

  return isMediaStorageError(input.error) && input.error.retryable
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve()
  }

  return new Promise((resolve) => setTimeout(resolve, ms))
}

function addCleanupDeleteResult(
  result: DeleteObjectsResult | undefined,
  sets: CleanupDeleteSets
): void {
  if (!result) {
    return
  }

  for (const key of result.deletedKeys) {
    sets.deletedKeys.add(key)
  }
  for (const key of result.missingKeys) {
    sets.missingKeys.add(key)
  }
  for (const failed of result.failedKeys) {
    sets.failedKeys.add(failed.key)
  }
}

export function createMediaStorageContext<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  config: MediaStorageConfig<TAssetId, TActorId, TKind>
): MediaStorageContext<TAssetId, TActorId, TKind> {
  const clock = config.clock ?? systemClock
  const logger = config.logger ?? noopLogger
  const policies = mergeMediaStoragePolicies<TKind>(config.policies)
  validateMediaStoragePolicies(policies)
  const retryPolicy = resolveRetryPolicy(config)
  const shouldProcessAsImage = policies.isImageKind ?? defaultIsImageKind

  if (policies.objectDeletionMode === "outbox") {
    if (!config.repository.transaction) {
      throw new MediaConfigurationError(
        "policies.objectDeletionMode='outbox' requires repository.transaction()."
      )
    }

    if (!config.repository.enqueueObjectDeletions) {
      throw new MediaConfigurationError(
        "policies.objectDeletionMode='outbox' requires repository.enqueueObjectDeletions()."
      )
    }
  }

  function getConfiguredPublicUrl(key: string): string | null {
    if (policies.persistPublicUrl === false) {
      return null
    }

    return config.storage.getPublicUrl?.(key) ?? null
  }

  function assertStorageSupportsUploads(): void {
    if (!config.storage.createUploadTarget && !config.storage.createPresignedPutUrl) {
      throw new CapabilityNotSupportedError("uploadTarget", { provider: config.storage.name })
    }

    if (
      policies.requireExactUploadSizeEnforcement &&
      !config.storage.capabilities?.exactUploadSize
    ) {
      throw new CapabilityNotSupportedError("exactUploadSize", { provider: config.storage.name })
    }
  }

  async function retry<T>(
    operation: string,
    task: () => Promise<T>,
    options: { signal?: AbortSignal } = {}
  ): Promise<T> {
    let attempt = 1
    let delayMs = retryPolicy.initialDelayMs

    while (true) {
      throwIfAborted(options.signal)

      try {
        return await task()
      } catch (error) {
        if (
          options.signal?.aborted ||
          attempt >= retryPolicy.maxAttempts ||
          !shouldRetryError(retryPolicy, { error, attempt, operation })
        ) {
          throw error
        }

        logger.warn?.("Retrying media storage operation after retryable failure.", {
          operation,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          error,
        })

        await wait(delayMs)
        delayMs = Math.min(retryPolicy.maxDelayMs, delayMs * retryPolicy.backoffMultiplier)
        attempt += 1
      }
    }
  }

  async function createUploadTarget(input: UploadTargetRequest): Promise<UploadTargetResponse> {
    return await retry("createUploadTarget", async () => {
      if (config.storage.createUploadTarget) {
        return await config.storage.createUploadTarget(input)
      }

      if (config.storage.createPresignedPutUrl) {
        return await config.storage.createPresignedPutUrl(input)
      }

      throw new CapabilityNotSupportedError("uploadTarget", { provider: config.storage.name })
    })
  }

  function createObjectDeletionRequests(input: {
    keys: string[]
    reason: MediaObjectDeletionReason
    assetId?: TAssetId | null
    sessionId?: string | null
    context?: Record<string, unknown> | null
  }): EnqueueObjectDeletionRequest<TAssetId>[] {
    const requestedAt = clock.now()
    return Array.from(new Set(input.keys.filter(Boolean))).map((objectKey) => ({
      objectKey,
      reason: input.reason,
      assetId: input.assetId ?? null,
      sessionId: input.sessionId ?? null,
      requestedAt,
      context: input.context ?? null,
    }))
  }

  async function enqueueObjectDeletions(
    repository: MediaRepository<TAssetId, TActorId, TKind>,
    requests: EnqueueObjectDeletionRequest<TAssetId>[]
  ): Promise<boolean> {
    if (!requests.length || policies.objectDeletionMode !== "outbox") {
      return false
    }

    if (!repository.enqueueObjectDeletions) {
      throw new MediaConfigurationError(
        "policies.objectDeletionMode='outbox' requires repository.enqueueObjectDeletions()."
      )
    }

    await repository.enqueueObjectDeletions({ requests })
    return true
  }

  async function deleteObjectBestEffort(
    key: string,
    message: string,
    context: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await retry("deleteObject", () => config.storage.deleteObject(key))
    } catch (error) {
      if (config.storage.isObjectNotFoundError?.(error)) {
        return
      }

      logger.warn?.(message, { key, error, ...context })
    }
  }

  async function deleteObjectsBestEffort(
    keys: string[],
    message: string,
    context: Record<string, unknown> = {}
  ): Promise<void> {
    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))

    if (!uniqueKeys.length) {
      return
    }

    if (config.storage.deleteObjects) {
      try {
        const result = await retry(
          "deleteObjects",
          () => config.storage.deleteObjects?.(uniqueKeys) ?? Promise.resolve(undefined)
        )
        for (const failed of result?.failedKeys ?? []) {
          logger.warn?.(message, { ...context, key: failed.key, error: failed.error })
        }
        return
      } catch (error) {
        logger.warn?.("Batch media object delete failed; falling back to individual deletes.", {
          error,
          ...context,
        })
      }
    }

    for (const key of uniqueKeys) {
      await deleteObjectBestEffort(key, message, context)
    }
  }

  async function deleteUploadedVariantsBestEffort(keys: string[]): Promise<void> {
    const requests = createObjectDeletionRequests({ keys, reason: "variant_cleanup" })

    if (policies.objectDeletionMode === "outbox") {
      await enqueueObjectDeletions(config.repository, requests).catch((error) => {
        logger.error?.("Failed to enqueue media variant cleanup in deletion outbox.", { error })
      })
    }

    await deleteObjectsBestEffort(keys, "Failed to clean up uploaded media variant.")
  }

  async function deleteObjectForCleanup(key: string, sets: CleanupDeleteSets): Promise<void> {
    if (sets.deletedKeys.has(key) || sets.missingKeys.has(key) || sets.failedKeys.has(key)) {
      return
    }

    try {
      await retry("cleanup.deleteObject", () => config.storage.deleteObject(key))
      sets.deletedKeys.add(key)
    } catch (error) {
      if (config.storage.isObjectNotFoundError?.(error)) {
        sets.missingKeys.add(key)
        return
      }

      sets.failedKeys.add(key)
      logger.warn?.("Failed to delete media object during cleanup.", { key, error })
    }
  }

  async function deleteObjectsForCleanup(keys: string[], sets: CleanupDeleteSets): Promise<void> {
    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))

    if (!uniqueKeys.length) {
      return
    }

    if (config.storage.deleteObjects) {
      try {
        const result = await retry(
          "cleanup.deleteObjects",
          () => config.storage.deleteObjects?.(uniqueKeys) ?? Promise.resolve(undefined)
        )

        if (!result) {
          for (const key of uniqueKeys) {
            sets.deletedKeys.add(key)
          }
          return
        }

        addCleanupDeleteResult(result, sets)
        for (const failed of result.failedKeys) {
          logger.warn?.("Failed to delete media object during cleanup.", {
            key: failed.key,
            error: failed.error,
          })
        }
        return
      } catch (error) {
        logger.warn?.("Batch cleanup delete failed; falling back to individual deletes.", { error })
      }
    }

    for (const key of uniqueKeys) {
      await deleteObjectForCleanup(key, sets)
    }
  }

  return {
    config,
    clock,
    logger,
    policies,
    shouldProcessAsImage,
    getConfiguredPublicUrl,
    assertStorageSupportsUploads,
    createUploadTarget,
    retry,
    deleteObjectBestEffort,
    deleteObjectsBestEffort,
    createObjectDeletionRequests,
    enqueueObjectDeletions,
    deleteUploadedVariantsBestEffort,
    deleteObjectsForCleanup,
  }
}
