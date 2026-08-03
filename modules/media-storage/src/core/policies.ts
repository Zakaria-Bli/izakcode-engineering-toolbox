import { DefaultMediaAssetKind } from "../domain/states.js"
import type { ImageVariantDefinition, MediaAssetKind, MediaDeletionMode } from "../domain/types.js"

export type ObjectDeletionMode = "best-effort" | "outbox"
import type { ImageDimensionLimits } from "../ports/image-processor.js"

/** Path-prefix allow-list or predicate used before object key generation. */
export interface UploadPathPrefixPolicy {
  allowedPrefixes?: readonly string[]
  allow?: (pathPrefix: string) => boolean
}

/** Limits and validation hooks for user-supplied asset metadata. */
export interface MediaMetadataPolicy {
  maxBytes?: number
  maxDepth?: number
  maxKeys?: number
  allowedKeys?: readonly string[]
  validate?: (metadata: Record<string, unknown>) => void
}

/** Stable policy surface controlling validation, lifetimes, image variants, and URL behavior. */
export interface MediaStoragePolicies<TKind extends string = MediaAssetKind> {
  /** Allowed normalized MIME types per app-defined asset kind. */
  allowedMimeTypesByKind: Partial<Record<TKind, readonly string[]>> &
    Record<string, readonly string[] | undefined>
  /** Maximum upload size in bytes per asset kind. */
  maxSizeByKind: Partial<Record<TKind, number>> & Record<string, number | undefined>
  /** Upload session lifetime in milliseconds. */
  uploadSessionTtlMs: number
  /** Direct upload URL lifetime in milliseconds; defaults to `uploadSessionTtlMs`. */
  presignedUploadTtlMs?: number
  /** Age after which orphan/stale records become cleanup candidates. */
  orphanTtlMs: number
  /** Optional path-prefix restrictions for upload intent and move targets. */
  pathPrefixes?: UploadPathPrefixPolicy
  /** Image dimension constraints enforced during completion for image kinds. */
  imageDimensionLimits: ImageDimensionLimits
  /** Image variants generated during completion for image kinds. */
  variants: ImageVariantDefinition[]
  /** Repository deletion behavior requested by core. */
  deletionMode: MediaDeletionMode
  /** Object-store deletion durability mode. `outbox` requires repository transaction + enqueue support. */
  objectDeletionMode: ObjectDeletionMode
  /** Maximum signed download URL lifetime in seconds. */
  maxDownloadUrlExpirySeconds?: number
  /** Maximum object size allowed for buffer fallback paths during completion. */
  maxCompletionBufferBytes?: number
  /** Require providers to enforce exact upload size before object creation. */
  requireExactUploadSizeEnforcement?: boolean
  /** Whether core should persist/generated durable public URLs. */
  persistPublicUrl?: boolean
  /** MIME normalization used for validation comparisons. */
  normalizeMimeType?: (mimeType: string) => string
  /** Predicate deciding which app-specific kinds should run image processing. */
  isImageKind?: (kind: TKind | string) => boolean
  /** User metadata limits and custom validator. */
  metadata?: MediaMetadataPolicy
}

export const defaultImageVariantDefinitions: ImageVariantDefinition[] = [
  {
    name: "thumbnail",
    width: 150,
    height: 150,
    quality: 80,
    format: "webp",
    fit: "cover",
  },
  {
    name: "card",
    width: 400,
    quality: 85,
    format: "webp",
    fit: "inside",
    withoutEnlargement: true,
  },
  {
    name: "full",
    width: 1_200,
    quality: 90,
    format: "webp",
    fit: "inside",
    withoutEnlargement: true,
  },
]

export const defaultMediaStoragePolicies: MediaStoragePolicies = {
  allowedMimeTypesByKind: {
    [DefaultMediaAssetKind.IMAGE]: ["image/jpeg", "image/png", "image/webp"],
    [DefaultMediaAssetKind.FILE]: [],
  },
  maxSizeByKind: {
    [DefaultMediaAssetKind.IMAGE]: 10 * 1024 * 1024,
    [DefaultMediaAssetKind.FILE]: 50 * 1024 * 1024,
  },
  uploadSessionTtlMs: 5 * 60 * 1_000,
  presignedUploadTtlMs: 5 * 60 * 1_000,
  orphanTtlMs: 24 * 60 * 60 * 1_000,
  imageDimensionLimits: {
    minWidth: 100,
    minHeight: 100,
    maxWidth: 16_383,
    maxHeight: 16_383,
  },
  variants: defaultImageVariantDefinitions,
  deletionMode: "tombstone",
  objectDeletionMode: "best-effort",
  maxDownloadUrlExpirySeconds: 3_600,
  maxCompletionBufferBytes: 50 * 1024 * 1024,
  requireExactUploadSizeEnforcement: false,
  persistPublicUrl: true,
  normalizeMimeType: (mimeType) => mimeType.split(";")[0]?.trim().toLowerCase() ?? "",
  isImageKind: (kind) => kind === DefaultMediaAssetKind.IMAGE,
  metadata: {
    maxBytes: 8 * 1024,
    maxDepth: 5,
    maxKeys: 50,
  },
}

/** Merge app overrides with defaults; nested policy maps are shallow-merged intentionally. */
export function mergeMediaStoragePolicies<TKind extends string = MediaAssetKind>(
  overrides: Partial<MediaStoragePolicies<TKind>> = {}
): MediaStoragePolicies<TKind> {
  return {
    ...defaultMediaStoragePolicies,
    ...overrides,
    allowedMimeTypesByKind: {
      ...defaultMediaStoragePolicies.allowedMimeTypesByKind,
      ...overrides.allowedMimeTypesByKind,
    } as MediaStoragePolicies<TKind>["allowedMimeTypesByKind"],
    maxSizeByKind: {
      ...defaultMediaStoragePolicies.maxSizeByKind,
      ...overrides.maxSizeByKind,
    } as MediaStoragePolicies<TKind>["maxSizeByKind"],
    imageDimensionLimits: {
      ...defaultMediaStoragePolicies.imageDimensionLimits,
      ...overrides.imageDimensionLimits,
    },
    variants: overrides.variants ?? defaultMediaStoragePolicies.variants,
    metadata: {
      ...defaultMediaStoragePolicies.metadata,
      ...overrides.metadata,
    },
  }
}
