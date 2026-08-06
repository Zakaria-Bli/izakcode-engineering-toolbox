import { randomUUID } from "node:crypto"

import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"
import {
  createS3StorageProvider,
  type S3StorageProviderCredentials,
} from "@toolbox/media-storage/adapters/s3"
import { createSharpImageProcessor } from "@toolbox/media-storage/adapters/sharp"
import {
  createDatePartitionedKeyStrategy,
  createInMemoryCompletionLimiter,
  createMediaStorage,
} from "@toolbox/media-storage/core"
import type { MediaRepository } from "@toolbox/media-storage/ports"

export interface S3CompatibleMediaConfig {
  bucket: string
  publicUrl: string
  endpoint?: string
  region?: string
  credentials?: S3StorageProviderCredentials
  forcePathStyle?: boolean
}

export function createS3CompatibleMediaStorage(
  repository: MediaRepository<string, string, "image" | "file">,
  config: S3CompatibleMediaConfig
) {
  const storage = createS3StorageProvider({
    bucket: config.bucket,
    publicUrl: config.publicUrl,
    endpoint: config.endpoint,
    region: config.region ?? "us-east-1",
    credentials: config.credentials,
    forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
    uploadTargetMode: "post",
    uploadOptions: {
      CacheControl: "public, max-age=31536000, immutable",
    },
  })

  return createMediaStorage<string, string, "image" | "file">({
    repository,
    storage,
    imageProcessor: createSharpImageProcessor(),
    contentInspector: createBasicContentInspector(),
    keyStrategy: createDatePartitionedKeyStrategy({ basePrefix: "media" }),
    idGenerator: {
      createAssetId: () => randomUUID(),
      createSessionId: () => randomUUID(),
      createObjectNonce: () => randomUUID(),
    },
    limiter: createInMemoryCompletionLimiter({ maxConcurrent: 4, maxQueued: 100 }),
    retryPolicy: { maxAttempts: 3, initialDelayMs: 200, maxDelayMs: 2_000 },
    policies: {
      allowedMimeTypesByKind: {
        image: ["image/jpeg", "image/png", "image/webp"],
        file: ["application/pdf"],
      },
      maxSizeByKind: {
        image: 10 * 1024 * 1024,
        file: 50 * 1024 * 1024,
      },
      requireExactUploadSizeEnforcement: true,
      maxCompletionBufferBytes: 50 * 1024 * 1024,
      deletionMode: "tombstone",
    },
  })
}
