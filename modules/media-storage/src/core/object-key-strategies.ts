import { InvalidMediaRequestError } from "../domain/errors.js"
import type { MediaId } from "../domain/types.js"
import type {
  BuildOriginalObjectKeyInput,
  BuildVariantObjectKeyInput,
  ObjectKeyStrategy,
} from "../ports/key-strategy.js"
import { assertValidObjectKey } from "../ports/object-key-validation.js"

export { assertValidObjectKey } from "../ports/object-key-validation.js"

const DEFAULT_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function cleanPrefix(prefix: string): string {
  return prefix.replace(/^\/+/, "").replace(/\/+$/, "")
}

function extensionFromFilename(filename?: string): string | null {
  if (!filename) {
    return null
  }

  const lastSegment = filename.split(/[\\/]/).pop() ?? ""
  const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() : null

  if (!extension || !/^[a-z0-9]{1,16}$/i.test(extension)) {
    return null
  }

  return extension.toLowerCase()
}

export function getSafeExtension(
  mimeType: string,
  filename?: string,
  mimeExtensions: Record<string, string> = DEFAULT_MIME_EXTENSIONS,
  allowFilenameExtensionFallback = false
): string | null {
  return (
    mimeExtensions[mimeType.trim().toLowerCase()] ??
    (allowFilenameExtensionFallback ? extensionFromFilename(filename) : null)
  )
}

function buildDefaultMovedObjectKey(input: {
  assetId: MediaId
  fromKey: string
  toPrefix: string
}): string {
  const filename = input.fromKey.split("/").pop()

  if (!filename) {
    throw new InvalidMediaRequestError("Cannot move media object without a filename.", {
      fromKey: input.fromKey,
    })
  }

  const key = `${cleanPrefix(input.toPrefix)}/${String(input.assetId)}/${filename}`
  assertValidObjectKey(key)
  return key
}

export interface DatePartitionedKeyStrategyOptions {
  basePrefix?: string
  mimeExtensions?: Record<string, string>
  allowFilenameExtensionFallback?: boolean
}

export function createDatePartitionedKeyStrategy<TAssetId extends MediaId = MediaId>(
  options: DatePartitionedKeyStrategyOptions = {}
): ObjectKeyStrategy<TAssetId> {
  const basePrefix = cleanPrefix(options.basePrefix ?? "media")
  const mimeExtensions = options.mimeExtensions ?? DEFAULT_MIME_EXTENSIONS
  const allowFilenameExtensionFallback = options.allowFilenameExtensionFallback ?? false

  return {
    buildOriginalObjectKey(input: BuildOriginalObjectKeyInput<TAssetId>): string {
      const extension = getSafeExtension(
        input.mimeType,
        input.filename,
        mimeExtensions,
        allowFilenameExtensionFallback
      )

      if (!extension) {
        throw new InvalidMediaRequestError("Unable to resolve safe file extension.", {
          mimeType: input.mimeType,
          filename: input.filename,
        })
      }

      if (input.assetId === undefined || input.assetId === null) {
        throw new InvalidMediaRequestError("Date-partitioned media keys require an asset ID.")
      }

      const year = input.now.getUTCFullYear()
      const month = pad2(input.now.getUTCMonth() + 1)
      const prefix = input.pathPrefix ? cleanPrefix(input.pathPrefix) : basePrefix
      const key = `${prefix}/${year}/${month}/${String(input.assetId)}/original.${extension}`
      assertValidObjectKey(key)
      return key
    },

    buildVariantObjectKey(input: BuildVariantObjectKeyInput<TAssetId>): string {
      const year = input.createdAt.getUTCFullYear()
      const month = pad2(input.createdAt.getUTCMonth() + 1)
      const prefix = input.originalObjectKey.split("/").slice(0, -1).join("/")
      const fallbackPrefix = `${basePrefix}/${year}/${month}/${String(input.assetId)}`
      const key = `${prefix || fallbackPrefix}/${input.variantType}.${input.format}`
      assertValidObjectKey(key)
      return key
    },

    buildMovedObjectKey(input): string {
      return buildDefaultMovedObjectKey(input)
    },

    getSafeExtension(mimeType: string, filename?: string): string | null {
      return getSafeExtension(mimeType, filename, mimeExtensions, allowFilenameExtensionFallback)
    },

    validateObjectKey: assertValidObjectKey,
  }
}

export interface PrefixKeyStrategyOptions {
  defaultPrefix?: string
  mimeExtensions?: Record<string, string>
  allowFilenameExtensionFallback?: boolean
}

export function createPrefixKeyStrategy<TAssetId extends MediaId = MediaId>(
  options: PrefixKeyStrategyOptions = {}
): ObjectKeyStrategy<TAssetId> {
  const defaultPrefix = cleanPrefix(options.defaultPrefix ?? "public")
  const mimeExtensions = options.mimeExtensions ?? DEFAULT_MIME_EXTENSIONS
  const allowFilenameExtensionFallback = options.allowFilenameExtensionFallback ?? false

  return {
    buildOriginalObjectKey(input: BuildOriginalObjectKeyInput<TAssetId>): string {
      const extension = getSafeExtension(
        input.mimeType,
        input.filename,
        mimeExtensions,
        allowFilenameExtensionFallback
      )

      if (!extension) {
        throw new InvalidMediaRequestError("Unable to resolve safe file extension.", {
          mimeType: input.mimeType,
          filename: input.filename,
        })
      }

      const prefix = input.pathPrefix ? cleanPrefix(input.pathPrefix) : defaultPrefix
      const key = `${prefix}/${input.now.getTime()}-${input.objectNonce}.${extension}`
      assertValidObjectKey(key)
      return key
    },

    buildVariantObjectKey(input: BuildVariantObjectKeyInput<TAssetId>): string {
      const pathParts = input.originalObjectKey.split("/")
      const filename = pathParts.pop() ?? "original"
      const nameWithoutExtension = filename.includes(".")
        ? filename.split(".").slice(0, -1).join(".")
        : filename
      const path = pathParts.join("/")
      const key = `${path}/${nameWithoutExtension}-${input.variantType}.${input.format}`
      assertValidObjectKey(key)
      return key
    },

    buildMovedObjectKey(input): string {
      return buildDefaultMovedObjectKey(input)
    },

    getSafeExtension(mimeType: string, filename?: string): string | null {
      return getSafeExtension(mimeType, filename, mimeExtensions, allowFilenameExtensionFallback)
    },

    validateObjectKey: assertValidObjectKey,
  }
}
