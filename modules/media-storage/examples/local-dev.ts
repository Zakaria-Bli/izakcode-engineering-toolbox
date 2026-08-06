import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"
import { createLocalStorageProvider } from "@toolbox/media-storage/adapters/local"
import { createSharpImageProcessor } from "@toolbox/media-storage/adapters/sharp"
import {
  createInMemoryCompletionLimiter,
  createMediaStorage,
  createPrefixKeyStrategy,
} from "@toolbox/media-storage/core"
import type { MediaRepository } from "@toolbox/media-storage/ports"

export function createLocalDevMediaStorage(
  repository: MediaRepository<string, string, "image" | "file">
) {
  return createMediaStorage<string, string, "image" | "file">({
    repository,
    storage: createLocalStorageProvider({
      rootDirectory: join(process.cwd(), ".media-storage"),
      publicUrl: "http://localhost:3000/media-files",
      uploadUrl: "http://localhost:3000/api/media/local-put",
      signingSecret: process.env.MEDIA_LOCAL_SIGNING_SECRET ?? "dev-only-change-me",
    }),
    imageProcessor: createSharpImageProcessor(),
    contentInspector: createBasicContentInspector(),
    keyStrategy: createPrefixKeyStrategy({ defaultPrefix: "uploads" }),
    idGenerator: {
      createAssetId: () => randomUUID(),
      createSessionId: () => randomUUID(),
      createObjectNonce: () => randomUUID(),
    },
    limiter: createInMemoryCompletionLimiter({ maxConcurrent: 2, maxQueued: 20 }),
    policies: {
      allowedMimeTypesByKind: {
        image: ["image/jpeg", "image/png", "image/webp"],
        file: ["application/pdf"],
      },
      maxSizeByKind: {
        image: 10 * 1024 * 1024,
        file: 25 * 1024 * 1024,
      },
      requireExactUploadSizeEnforcement: true,
      pathPrefixes: { allowedPrefixes: ["uploads", "avatars", "documents"] },
      deletionMode: "tombstone",
    },
  })
}
