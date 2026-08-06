import {
  FileTooLargeError,
  InvalidMediaRequestError,
  MediaConfigurationError,
  UnsupportedMimeTypeError,
} from "../domain/errors.js"
import type {
  CreateUploadIntentInput,
  ImageMetadata,
  MediaActorId,
  MediaAssetKind,
  MediaUploadRecord,
} from "../domain/types.js"
import type { ImageDimensionLimits } from "../ports/image-processor.js"
import type { MediaMetadataPolicy, MediaStoragePolicies } from "./policies.js"

const FORBIDDEN_METADATA_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function normalizeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename
  const normalized = Array.from(basename.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 31 && codePoint !== 127
    })
    .join("")
    .trim()

  return normalized.length ? normalized.slice(0, 255) : "upload"
}

export function defaultNormalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? ""
}

export function normalizePathPrefix(pathPrefix?: string | null): string | null {
  if (!pathPrefix) {
    return null
  }

  const normalized = pathPrefix.trim().replace(/^\/+/, "").replace(/\/+$/, "")
  return normalized.length ? normalized : null
}

function findForbiddenMetadataKeys(
  value: unknown,
  path = "metadata",
  seen = new WeakSet<object>()
): string[] {
  if (!value || typeof value !== "object") {
    return []
  }

  if (seen.has(value)) {
    throw new InvalidMediaRequestError("Media metadata must be JSON serializable.")
  }
  seen.add(value)

  const forbiddenKeys: string[] = []
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  for (const [key, child] of entries) {
    const childPath = `${path}.${key}`

    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      forbiddenKeys.push(childPath)
    }

    forbiddenKeys.push(...findForbiddenMetadataKeys(child, childPath, seen))
  }

  return forbiddenKeys
}

function countMetadataKeys(value: unknown, seen = new WeakSet<object>()): number {
  if (!value || typeof value !== "object") {
    return 0
  }

  if (seen.has(value)) {
    throw new InvalidMediaRequestError("Media metadata must be JSON serializable.")
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countMetadataKeys(item, seen), 0)
  }

  return Object.values(value).reduce((count, item) => count + 1 + countMetadataKeys(item, seen), 0)
}

function getMetadataDepth(value: unknown, seen = new WeakSet<object>()): number {
  if (!value || typeof value !== "object") {
    return 0
  }

  if (seen.has(value)) {
    throw new InvalidMediaRequestError("Media metadata must be JSON serializable.")
  }
  seen.add(value)

  const children = Array.isArray(value) ? value : Object.values(value)
  return 1 + Math.max(0, ...children.map((child) => getMetadataDepth(child, seen)))
}

export function validateMetadata(
  metadata: Record<string, unknown> | null | undefined,
  policy: MediaMetadataPolicy = {}
): Record<string, unknown> | null {
  if (metadata === undefined || metadata === null) {
    return null
  }

  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new InvalidMediaRequestError("Media metadata must be an object.")
  }

  const forbiddenKeys = findForbiddenMetadataKeys(metadata)
  if (forbiddenKeys.length) {
    throw new InvalidMediaRequestError("Media metadata contains forbidden keys.", {
      forbiddenKeys,
    })
  }

  const allowedKeys = policy.allowedKeys ? new Set(policy.allowedKeys) : null
  if (allowedKeys) {
    const disallowedKeys = Object.keys(metadata).filter((key) => !allowedKeys.has(key))
    if (disallowedKeys.length) {
      throw new InvalidMediaRequestError("Media metadata contains unsupported keys.", {
        disallowedKeys,
        allowedKeys: [...allowedKeys],
      })
    }
  }

  const maxKeys = policy.maxKeys ?? 50
  const keyCount = countMetadataKeys(metadata)
  if (keyCount > maxKeys) {
    throw new InvalidMediaRequestError("Media metadata contains too many keys.", {
      keyCount,
      maxKeys,
    })
  }

  const maxDepth = policy.maxDepth ?? 5
  const depth = getMetadataDepth(metadata)
  if (depth > maxDepth) {
    throw new InvalidMediaRequestError("Media metadata is too deeply nested.", { depth, maxDepth })
  }

  let serialized: string
  try {
    serialized = JSON.stringify(metadata)
  } catch (error) {
    throw new InvalidMediaRequestError("Media metadata must be JSON serializable.", {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const maxBytes = policy.maxBytes ?? 8 * 1024
  const byteLength = Buffer.byteLength(serialized)
  if (byteLength > maxBytes) {
    throw new InvalidMediaRequestError("Media metadata is too large.", { byteLength, maxBytes })
  }

  const sanitized = JSON.parse(serialized) as Record<string, unknown>
  policy.validate?.(sanitized)
  return sanitized
}

export function assertAllowedPathPrefix(
  pathPrefix: string | null,
  policies: MediaStoragePolicies
): void {
  if (!pathPrefix) {
    return
  }

  if (pathPrefix.includes("\\") || pathPrefix.includes("//")) {
    throw new InvalidMediaRequestError("Upload path prefix is invalid.", { pathPrefix })
  }

  const segments = pathPrefix.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw new InvalidMediaRequestError("Upload path prefix is invalid.", { pathPrefix })
  }

  const allowedPrefixes = policies.pathPrefixes?.allowedPrefixes
  const customAllow = policies.pathPrefixes?.allow

  if (allowedPrefixes?.length && !allowedPrefixes.includes(pathPrefix)) {
    throw new InvalidMediaRequestError("Upload path prefix is not allowed.", {
      pathPrefix,
      allowedPrefixes: [...allowedPrefixes],
    })
  }

  if (customAllow && !customAllow(pathPrefix)) {
    throw new InvalidMediaRequestError("Upload path prefix is not allowed.", { pathPrefix })
  }
}

export interface ValidatedUploadIntentInput<
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> extends CreateUploadIntentInput<TActorId, TKind> {
  filename: string
  mimeType: string
  pathPrefix: string | null
  actorId: TActorId | null
}

export function validateCreateUploadIntentInput<
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  input: CreateUploadIntentInput<TActorId, TKind>,
  policies: MediaStoragePolicies<TKind>
): ValidatedUploadIntentInput<TActorId, TKind> {
  const filename = normalizeFilename(input.filename)
  const normalizeMimeType = policies.normalizeMimeType ?? defaultNormalizeMimeType
  const mimeType = normalizeMimeType(input.mimeType)
  const pathPrefix = normalizePathPrefix(input.pathPrefix)

  if (!input.kind || typeof input.kind !== "string") {
    throw new InvalidMediaRequestError("Media asset kind is required.")
  }

  if (!Number.isInteger(input.size) || input.size < 1) {
    throw new InvalidMediaRequestError("Media file size must be a positive integer.", {
      size: input.size,
    })
  }

  if (!mimeType) {
    throw new InvalidMediaRequestError("Media MIME type is required.")
  }

  const allowedMimeTypes: readonly string[] = policies.allowedMimeTypesByKind[input.kind] ?? []
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new UnsupportedMimeTypeError(mimeType, allowedMimeTypes)
  }

  const maxSize = policies.maxSizeByKind[input.kind]
  if (maxSize !== undefined && input.size > maxSize) {
    throw new FileTooLargeError(input.size, maxSize)
  }

  assertAllowedPathPrefix(pathPrefix, policies)
  const metadata = validateMetadata(input.metadata, policies.metadata)

  return {
    ...input,
    filename,
    mimeType,
    pathPrefix,
    actorId: input.actorId ?? null,
    metadata,
  }
}

export function validateStoredObjectMetadata(
  record: MediaUploadRecord,
  metadata: { contentType: string | null; contentLength: number | null } | null,
  normalizeMimeType: (mimeType: string) => string = defaultNormalizeMimeType
): void {
  if (!metadata) {
    throw new InvalidMediaRequestError("Uploaded object was not found.", {
      objectKey: record.session.objectKey,
    })
  }

  const expectedMime = normalizeMimeType(record.session.expectedMime)
  const actualMime = metadata.contentType ? normalizeMimeType(metadata.contentType) : ""

  if (actualMime !== expectedMime) {
    throw new InvalidMediaRequestError("Uploaded object type does not match expected type.", {
      expectedMime: record.session.expectedMime,
      actualMime: metadata.contentType,
    })
  }

  if (metadata.contentLength !== record.session.expectedSize) {
    throw new InvalidMediaRequestError("Uploaded object size does not match expected size.", {
      expectedSize: record.session.expectedSize,
      actualSize: metadata.contentLength,
    })
  }
}

export function validateImageMetadata(metadata: ImageMetadata, limits: ImageDimensionLimits): void {
  const minWidth = limits.minWidth ?? 1
  const minHeight = limits.minHeight ?? 1
  const maxWidth = limits.maxWidth ?? Number.MAX_SAFE_INTEGER
  const maxHeight = limits.maxHeight ?? Number.MAX_SAFE_INTEGER

  if (metadata.width < minWidth || metadata.height < minHeight) {
    throw new InvalidMediaRequestError("Image dimensions are below minimum requirements.", {
      width: metadata.width,
      height: metadata.height,
      minWidth,
      minHeight,
    })
  }

  if (metadata.width > maxWidth || metadata.height > maxHeight) {
    throw new InvalidMediaRequestError("Image dimensions exceed maximum requirements.", {
      width: metadata.width,
      height: metadata.height,
      maxWidth,
      maxHeight,
    })
  }
}

export function validateMediaStoragePolicies(policies: MediaStoragePolicies): void {
  const numericFields = [
    ["uploadSessionTtlMs", policies.uploadSessionTtlMs],
    ["presignedUploadTtlMs", policies.presignedUploadTtlMs],
    ["orphanTtlMs", policies.orphanTtlMs],
    ["maxDownloadUrlExpirySeconds", policies.maxDownloadUrlExpirySeconds],
    ["maxCompletionBufferBytes", policies.maxCompletionBufferBytes],
  ] as const

  for (const [field, value] of numericFields) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new MediaConfigurationError(`${field} must be a positive number.`, { [field]: value })
    }
  }

  for (const [kind, maxSize] of Object.entries(policies.maxSizeByKind)) {
    if (maxSize !== undefined && (!Number.isFinite(maxSize) || maxSize <= 0)) {
      throw new MediaConfigurationError("Media max size policy must be positive.", {
        kind,
        maxSize,
      })
    }
  }

  for (const variant of policies.variants) {
    if (!variant.name.trim()) {
      throw new MediaConfigurationError("Image variant name is required.", { variant })
    }

    if (!Number.isFinite(variant.width) || variant.width < 1) {
      throw new MediaConfigurationError("Image variant width must be positive.", { variant })
    }

    if (variant.height !== undefined && (!Number.isFinite(variant.height) || variant.height < 1)) {
      throw new MediaConfigurationError("Image variant height must be positive.", { variant })
    }

    if (!Number.isFinite(variant.quality) || variant.quality < 1 || variant.quality > 100) {
      throw new MediaConfigurationError("Image variant quality must be between 1 and 100.", {
        variant,
      })
    }
  }

  const metadata = policies.metadata
  if (metadata) {
    for (const [field, value] of Object.entries({
      maxBytes: metadata.maxBytes,
      maxDepth: metadata.maxDepth,
      maxKeys: metadata.maxKeys,
    })) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
        throw new MediaConfigurationError(`Metadata ${field} must be a positive integer.`, {
          [field]: value,
        })
      }
    }
  }
}

export function truncateFailureReason(error: unknown, maxLength = 1_000): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, maxLength)
}
