import { createHash } from "node:crypto"

import {
  CapabilityNotSupportedError,
  ChecksumMismatchError,
  ContentMismatchError,
  InvalidMediaRequestError,
  isMediaStorageError,
  MediaConfigurationError,
  UploadSessionExpiredError,
  UploadSessionNotFoundError,
  UploadSessionStateError,
} from "../../domain/errors.js"
import { MediaAssetStatus, MediaUploadSessionStatus } from "../../domain/states.js"
import type {
  CompleteUploadInput,
  CompleteUploadResult,
  MediaActorId,
  MediaAssetKind,
  MediaId,
  MediaUploadRecord,
  PreparedMediaVariant,
  StoredObjectMetadata,
} from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"
import { getImageContentType, throwIfAborted } from "../context.js"
import {
  truncateFailureReason,
  validateImageMetadata,
  validateStoredObjectMetadata,
} from "../validation.js"

function calculateSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

interface LoadedSourceObject {
  checksum: string
  buffer: Buffer | null
}

function getMaxCompletionBufferBytes(policies: { maxCompletionBufferBytes?: number }): number {
  return policies.maxCompletionBufferBytes ?? 50 * 1024 * 1024
}

function assertBufferAllowed(input: {
  expectedSize: number
  maxCompletionBufferBytes: number
  provider: string
  reason: string
}): void {
  if (input.expectedSize > input.maxCompletionBufferBytes) {
    throw new InvalidMediaRequestError("Uploaded object exceeds completion buffer limit.", input)
  }
}

async function hashStreamAndMaybeBuffer(input: {
  body: AsyncIterable<Uint8Array>
  needsBuffer: boolean
  maxCompletionBufferBytes: number
  signal?: AbortSignal
}): Promise<{ checksum: string; size: number; buffer: Buffer | null }> {
  const hash = createHash("sha256")
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of input.body) {
    throwIfAborted(input.signal)
    const buffer = Buffer.from(chunk)
    size += buffer.length
    hash.update(buffer)

    if (input.needsBuffer) {
      if (size > input.maxCompletionBufferBytes) {
        throw new InvalidMediaRequestError("Uploaded object exceeds completion buffer limit.", {
          size,
          maxCompletionBufferBytes: input.maxCompletionBufferBytes,
        })
      }
      chunks.push(buffer)
    }
  }

  return {
    checksum: hash.digest("hex"),
    size,
    buffer: input.needsBuffer ? Buffer.concat(chunks, size) : null,
  }
}

function validateStreamedObjectSize(record: MediaUploadRecord, size: number): void {
  if (size !== record.session.expectedSize) {
    throw new InvalidMediaRequestError("Uploaded object size does not match expected size.", {
      expectedSize: record.session.expectedSize,
      actualSize: size,
    })
  }
}

function requireSourceBuffer(sourceBuffer: Buffer | null): Buffer {
  if (!sourceBuffer) {
    throw new InvalidMediaRequestError("Completion workflow requires a buffered source object.")
  }

  return sourceBuffer
}

async function loadSourceObject<
  TAssetId extends MediaId,
  TActorId extends MediaActorId,
  TKind extends string,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  record: MediaUploadRecord<TAssetId, TActorId, TKind>,
  input: { needsBuffer: boolean; signal?: AbortSignal }
): Promise<LoadedSourceObject> {
  const { config, policies } = context
  const maxCompletionBufferBytes = getMaxCompletionBufferBytes(policies)

  if (input.needsBuffer) {
    assertBufferAllowed({
      expectedSize: record.session.expectedSize,
      maxCompletionBufferBytes,
      provider: config.storage.name,
      reason: "content inspection or image processing requires a buffer",
    })
  }

  if (config.storage.getObjectStream) {
    const streamedObject = await context.retry(
      "getObjectStream",
      () =>
        config.storage.getObjectStream?.({
          key: record.session.objectKey,
          signal: input.signal,
        }) ?? Promise.reject(new CapabilityNotSupportedError("getObjectStream")),
      { signal: input.signal }
    )
    throwIfAborted(input.signal)
    validateStoredObjectMetadata(
      record,
      streamedObject.metadata as StoredObjectMetadata,
      policies.normalizeMimeType
    )

    const streamed = await hashStreamAndMaybeBuffer({
      body: streamedObject.body,
      needsBuffer: input.needsBuffer,
      maxCompletionBufferBytes,
      signal: input.signal,
    })
    throwIfAborted(input.signal)
    validateStreamedObjectSize(record, streamed.size)
    return { checksum: streamed.checksum, buffer: streamed.buffer }
  }

  if (record.session.expectedSize > maxCompletionBufferBytes) {
    throw new CapabilityNotSupportedError("getObjectStream", {
      provider: config.storage.name,
      expectedSize: record.session.expectedSize,
      maxCompletionBufferBytes,
    })
  }

  const metadata = await context.retry(
    "headObject",
    () => config.storage.headObject(record.session.objectKey, input.signal),
    { signal: input.signal }
  )
  throwIfAborted(input.signal)
  validateStoredObjectMetadata(record, metadata, policies.normalizeMimeType)

  const sourceBuffer = await context.retry(
    "getObjectBuffer",
    () => config.storage.getObjectBuffer(record.session.objectKey, input.signal),
    { signal: input.signal }
  )
  throwIfAborted(input.signal)
  validateStreamedObjectSize(record, sourceBuffer.length)
  return {
    checksum: calculateSha256(sourceBuffer),
    buffer: input.needsBuffer ? sourceBuffer : null,
  }
}

async function completeUploadWithoutLimiter<
  TAssetId extends MediaId,
  TActorId extends MediaActorId,
  TKind extends string,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: CompleteUploadInput<TActorId>
): Promise<CompleteUploadResult<TAssetId, TActorId, TKind>> {
  const { clock, config, logger, policies } = context
  let record: MediaUploadRecord<TAssetId, TActorId, TKind> | null = null
  let claimed = false
  const uploadedVariantKeys: string[] = []

  try {
    record = await config.repository.findUploadSessionWithAsset(input.sessionId)

    if (!record) {
      throw new UploadSessionNotFoundError(input.sessionId)
    }

    await config.actorPolicy?.assertCanCompleteUpload?.({
      actorId: input.actorId,
      record,
    })

    if (
      record.session.status === MediaUploadSessionStatus.COMPLETED ||
      record.asset.status === MediaAssetStatus.READY
    ) {
      const completed = await config.repository.findAssetWithVariants(record.asset.id)
      if (completed && completed.asset.status === MediaAssetStatus.READY) {
        return completed
      }
    }

    const now = clock.now()
    throwIfAborted(input.signal)

    if (
      record.session.status === MediaUploadSessionStatus.EXPIRED ||
      record.session.expiresAt <= now
    ) {
      await config.repository.expireUpload({
        sessionId: record.session.id,
        assetId: record.asset.id,
        failureReason: "Upload session expired.",
        now,
      })
      throw new UploadSessionExpiredError(record.session.id)
    }

    if (record.session.status !== MediaUploadSessionStatus.AWAITING) {
      throw new UploadSessionStateError(record.session.id, record.session.status)
    }

    if (record.asset.status !== MediaAssetStatus.PENDING_UPLOAD) {
      throw new UploadSessionStateError(record.session.id, `asset:${record.asset.status}`, {
        assetId: record.asset.id,
      })
    }

    claimed = await config.repository.claimUploadForProcessing({
      sessionId: record.session.id,
      assetId: record.asset.id,
      now,
    })

    if (!claimed) {
      throw new UploadSessionStateError(record.session.id, "claim_failed", {
        assetId: record.asset.id,
      })
    }

    const needsSourceBuffer =
      Boolean(config.contentInspector) || context.shouldProcessAsImage(record.asset.kind)
    const source = await loadSourceObject(context, record, {
      needsBuffer: needsSourceBuffer,
      signal: input.signal,
    })
    const checksum = source.checksum

    const inspection = await config.contentInspector?.inspect({
      buffer: requireSourceBuffer(source.buffer),
      filename: record.asset.originalFilename,
      expectedMimeType: record.asset.mimeType,
      kind: record.asset.kind,
      size: record.session.expectedSize,
      metadata: record.asset.metadata ?? null,
      signal: input.signal,
    })
    throwIfAborted(input.signal)

    if (inspection?.accepted === false) {
      throw new ContentMismatchError(record.asset.mimeType, inspection.detectedMimeType ?? null, {
        reason: inspection.reason,
        ...inspection.details,
      })
    }

    if (inspection?.detectedMimeType && inspection.accepted !== true) {
      const normalizeMimeType = policies.normalizeMimeType ?? ((mimeType: string) => mimeType)
      const expectedMimeType = normalizeMimeType(record.asset.mimeType)
      const detectedMimeType = normalizeMimeType(inspection.detectedMimeType)

      if (detectedMimeType !== expectedMimeType) {
        throw new ContentMismatchError(expectedMimeType, detectedMimeType, {
          filename: record.asset.originalFilename,
        })
      }
    }

    if (input.checksum && input.checksum !== checksum) {
      throw new ChecksumMismatchError(input.checksum, checksum)
    }

    let width: number | null = null
    let height: number | null = null
    const variants: PreparedMediaVariant[] = []

    if (context.shouldProcessAsImage(record.asset.kind)) {
      if (!config.imageProcessor) {
        throw new InvalidMediaRequestError("Image processor is required for image uploads.")
      }

      const normalizedBuffer = config.imageProcessor.normalize
        ? await config.imageProcessor.normalize({
            buffer: requireSourceBuffer(source.buffer),
            mimeType: record.asset.mimeType,
            signal: input.signal,
          })
        : requireSourceBuffer(source.buffer)
      throwIfAborted(input.signal)

      const imageMetadata = await config.imageProcessor.extractMetadata({
        buffer: normalizedBuffer,
        mimeType: record.asset.mimeType,
        signal: input.signal,
      })
      throwIfAborted(input.signal)

      validateImageMetadata(imageMetadata, policies.imageDimensionLimits)
      await config.imageProcessor.validate?.({
        metadata: imageMetadata,
        limits: policies.imageDimensionLimits,
        signal: input.signal,
      })
      throwIfAborted(input.signal)

      width = imageMetadata.width
      height = imageMetadata.height

      const processedVariants = await config.imageProcessor.processVariants({
        buffer: normalizedBuffer,
        variants: policies.variants,
        signal: input.signal,
      })
      throwIfAborted(input.signal)

      for (const variant of processedVariants) {
        const objectKey = config.keyStrategy.buildVariantObjectKey({
          assetId: record.asset.id,
          originalObjectKey: record.asset.objectKey,
          variantType: variant.variantType,
          format: variant.format,
          createdAt: record.asset.createdAt,
        })
        config.keyStrategy.validateObjectKey(objectKey)
        const publicUrl = context.getConfiguredPublicUrl(objectKey)

        await context.retry(
          "putVariantObject",
          () =>
            config.storage.putObject({
              key: objectKey,
              body: variant.buffer,
              contentType: getImageContentType(variant.format),
              signal: input.signal,
            }),
          { signal: input.signal }
        )
        throwIfAborted(input.signal)
        uploadedVariantKeys.push(objectKey)

        variants.push({
          variantType: variant.variantType,
          objectKey,
          publicUrl,
          buffer: variant.buffer,
          width: variant.width,
          height: variant.height,
          format: variant.format,
          size: variant.size,
          metadata: variant.metadata,
        })
      }
    }

    return await config.repository.completeUpload({
      sessionId: record.session.id,
      assetId: record.asset.id,
      publicUrl: context.getConfiguredPublicUrl(record.asset.objectKey),
      checksum,
      width,
      height,
      variants: variants.map((variant) => ({
        variantType: variant.variantType,
        objectKey: variant.objectKey,
        publicUrl: variant.publicUrl,
        width: variant.width,
        height: variant.height,
        format: variant.format,
        size: variant.size,
        metadata: variant.metadata,
      })),
      now: clock.now(),
    })
  } catch (error) {
    await context.deleteUploadedVariantsBestEffort(uploadedVariantKeys)

    if (record && claimed) {
      const retryable = isMediaStorageError(error) && error.retryable

      if (retryable && config.repository.releaseUploadClaim) {
        await config.repository
          .releaseUploadClaim({
            sessionId: record.session.id,
            assetId: record.asset.id,
            now: clock.now(),
          })
          .catch((releaseError) => {
            logger.error?.("Failed to release media upload claim after retryable failure.", {
              sessionId: record?.session.id,
              assetId: record?.asset.id,
              error: releaseError,
            })
          })
      } else {
        const failedRecord = record
        const deletionRequests = retryable
          ? []
          : context.createObjectDeletionRequests({
              keys: [failedRecord.session.objectKey],
              reason: "upload_failed",
              assetId: failedRecord.asset.id,
              sessionId: failedRecord.session.id,
            })
        const writeFailure = async (repository: typeof config.repository): Promise<void> => {
          await repository.failUpload({
            sessionId: failedRecord.session.id,
            assetId: failedRecord.asset.id,
            failureReason: truncateFailureReason(error),
            now: clock.now(),
          })
          await context.enqueueObjectDeletions(repository, deletionRequests)
        }
        let writeFailurePromise: Promise<void>
        if (policies.objectDeletionMode === "outbox") {
          if (!config.repository.transaction) {
            throw new MediaConfigurationError(
              "policies.objectDeletionMode='outbox' requires repository.transaction()."
            )
          }
          writeFailurePromise = config.repository.transaction(writeFailure)
        } else {
          writeFailurePromise = writeFailure(config.repository)
        }

        await writeFailurePromise.catch((failError) => {
          logger.error?.("Failed to mark media upload as failed.", {
            sessionId: record?.session.id,
            assetId: record?.asset.id,
            error: failError,
          })
        })

        if (!retryable) {
          await context.deleteObjectBestEffort(
            record.session.objectKey,
            "Failed to delete original media object after terminal completion failure.",
            { sessionId: failedRecord.session.id, assetId: failedRecord.asset.id }
          )
        }
      }
    }

    throw error
  }
}

async function runWithoutLimiter<T>(task: () => Promise<T>): Promise<T> {
  return await task()
}

export async function completeUpload<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: CompleteUploadInput<TActorId>
): Promise<CompleteUploadResult<TAssetId, TActorId, TKind>> {
  const runner = context.config.limiter?.run.bind(context.config.limiter) ?? runWithoutLimiter
  return await runner(() => completeUploadWithoutLimiter(context, input), input.signal)
}
