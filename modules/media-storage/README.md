# Media Storage Module

Status: production-ready reusable module.

`@toolbox/media-storage` is a framework-agnostic media storage module for direct browser uploads, upload-session lifecycle management, image variant generation, cleanup, moves, deletion, and pluggable object storage providers.

It keeps reusable media workflows separated from framework adapters, persistence adapters, and storage provider adapters.

## Architecture

```txt
modules/media-storage/
├── src/
│   ├── domain/      # types, states, errors
│   ├── ports/       # repository, storage, image processor, key strategy, runtime services
│   ├── core/        # framework-agnostic workflows
│   └── adapters/    # S3, local, Sharp, Express, Next integrations
├── tests/
├── examples/
└── recipes/
```

Dependency rule:

```txt
domain has no dependencies.
ports depend on domain only.
core depends on domain and ports only.
adapters depend inward and hold runtime/framework/provider details.
```

Core must not import Express, Next.js, React, Drizzle, Sharp, AWS SDK, app env, app auth, or app database schema.

## Entry points

Core and ports:

```ts
import { createMediaStorage, processObjectDeletionOutbox } from "@toolbox/media-storage/core"
import type {
  MediaRepository,
  ObjectDeletionOutbox,
  ObjectStorageProvider,
} from "@toolbox/media-storage/ports"
import { createMediaRepositoryContractSuite } from "@toolbox/media-storage/testing"
```

Adapters:

```ts
import { createS3StorageProvider } from "@toolbox/media-storage/adapters/s3"
import { createLocalStorageProvider } from "@toolbox/media-storage/adapters/local"
import { createSharpImageProcessor } from "@toolbox/media-storage/adapters/sharp"
import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"
import { createExpressMediaAdapter } from "@toolbox/media-storage/adapters/express"
import { createNextMediaRouteHandlers } from "@toolbox/media-storage/adapters/next"
```

## Core service

```ts
import {
  createInMemoryCompletionLimiter,
  createMediaStorage,
  createPrefixKeyStrategy,
} from "@toolbox/media-storage/core"
import { createS3StorageProvider } from "@toolbox/media-storage/adapters/s3"
import { createSharpImageProcessor } from "@toolbox/media-storage/adapters/sharp"
import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"

const media = createMediaStorage({
  repository,
  storage: createS3StorageProvider({
    bucket: "media",
    publicUrl: "https://cdn.example.com/media",
    uploadTargetMode: "post", // exact content-length-range enforcement
    endpoint: "http://localhost:8333",
    region: "us-east-1",
    credentials: {
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    },
    forcePathStyle: true,
  }),
  imageProcessor: createSharpImageProcessor(),
  contentInspector: createBasicContentInspector(),
  keyStrategy: createPrefixKeyStrategy(),
  idGenerator: {
    createSessionId: () => crypto.randomUUID(),
    createObjectNonce: () => crypto.randomUUID(),
  },
  limiter: createInMemoryCompletionLimiter({ maxConcurrent: 2, maxQueued: 20 }),
  retryPolicy: { maxAttempts: 3, initialDelayMs: 200 },
  policies: {
    allowedMimeTypesByKind: {
      image: ["image/jpeg", "image/png", "image/webp"],
    },
    maxSizeByKind: {
      image: 10 * 1024 * 1024,
    },
    deletionMode: "tombstone",
    requireExactUploadSizeEnforcement: true,
  },
})
```

Service methods:

```ts
await media.createUploadIntent(input)
await media.completeUpload({ sessionId, actorId, checksum, signal })
await media.cancelUpload({ sessionId, actorId })
await media.getAsset({ assetId, actorId })
await media.listAssets({ page, pageSize, actorId })
await media.getDownloadUrl({ assetId, variantType, actorId, expiresInSeconds })
await media.deleteAsset({ assetId, actorId })
await media.moveAssets({ assetIds, toPrefix, actorId })
await media.planCleanup({ limit })
await media.cleanup({ limit })
```

## Storage provider boundary

Storage providers own object operations only:

- create presigned PUT URL or provider-specific upload target
- head object
- read object buffer
- put object
- copy object
- delete object(s)
- build/parse public URLs and optionally create signed download URLs

They must not own database writes, upload session lifecycle, image processing, or authorization.

## Repository boundary

Applications implement `MediaRepository` for their database. The repository owns persistence only. Optional `markAssetsDeleted()` and `updateAssetObjectKeysBatch()` let cleanup and bulk moves use fewer database round-trips; core falls back to single-row methods when they are absent.

For durable object-delete retries, set `policies.objectDeletionMode: "outbox"`, implement repository `transaction()` and `enqueueObjectDeletions()`, then run `processObjectDeletionOutbox()` from a worker. See [`recipes/delete-outbox.md`](./recipes/delete-outbox.md).

See [`recipes/repositories.md`](./recipes/repositories.md).

## Framework adapters

Framework adapters are thin wrappers around the core service.

- Express-like adapter: `createExpressMediaAdapter()`
- Next/App-Router-like adapter: `createNextMediaRouteHandlers()`

Adapters own request parsing, auth hooks, permission hooks, response mapping, and error mapping.

Express handlers call `next(error)`. Mount `createExpressMediaErrorMiddleware()` or map `MediaStorageError` in your application error middleware. Next handlers catch and map errors internally.

Framework adapters fail closed unless an `authorize` hook is configured or an action is explicitly listed in `allowUnauthenticated`.

## Content inspection

Core validates declared MIME type and stored object metadata. For hostile upload environments, configure a `ContentInspector` implementation to verify magic bytes, scan files, or apply app-specific content checks before assets become `READY`.

Use the built-in basic inspector for common image/PDF/Office signatures:

```ts
import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"

const contentInspector = createBasicContentInspector()
```

## React UI boundary

React upload components are intentionally not exported by core. Keep UI in app code or a separate template/package.

See [`recipes/react-upload-ui.md`](./recipes/react-upload-ui.md).

## Documentation map

Start here by task:

- API shapes, service methods, policies, errors: [`API-REFERENCE.md`](./API-REFERENCE.md)
- Public stability contract: [`PUBLIC-CONTRACTS.md`](./PUBLIC-CONTRACTS.md)
- Adapter-specific setup: [`ADAPTERS.md`](./ADAPTERS.md)
- App integration model: [`INTEGRATION.md`](./INTEGRATION.md)
- Production operations/runbooks: [`OPERATIONS.md`](./OPERATIONS.md)
- Troubleshooting by symptom/error code: [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)

## Examples

- [`examples/local-dev.ts`](./examples/local-dev.ts)
- [`examples/s3-compatible.ts`](./examples/s3-compatible.ts)
- [`examples/custom-provider.ts`](./examples/custom-provider.ts)
- [`examples/express-routes.ts`](./examples/express-routes.ts)
- [`examples/next-route-handlers.ts`](./examples/next-route-handlers.ts)
- [`examples/delete-outbox-worker.ts`](./examples/delete-outbox-worker.ts)

## Recipes

- [`recipes/production-integration-checklist.md`](./recipes/production-integration-checklist.md)
- [`recipes/repositories.md`](./recipes/repositories.md)
- [`recipes/delete-outbox.md`](./recipes/delete-outbox.md)
- [`recipes/react-upload-ui.md`](./recipes/react-upload-ui.md)

## Validation

```sh
pnpm --filter @toolbox/media-storage typecheck
pnpm --filter @toolbox/media-storage build
pnpm --filter @toolbox/media-storage test
pnpm --filter @toolbox/media-storage lint
pnpm --filter @toolbox/media-storage pack:dry-run
```

Optional S3-compatible integration harness:

```sh
docker compose -f modules/media-storage/integration/s3-compatible/docker-compose.yml up -d
pnpm --filter @toolbox/media-storage test:integration:s3
```

Current tests cover:

- upload intent creation
- image upload completion and variant writes
- metadata mismatch failure handling
- cancellation
- usage-policy delete blocking
- move rollback
- cleanup
- local adapter signing
- local adapter object operations
- local adapter traversal rejection
- move collision safety
- Express adapter request parsing, auth fail-closed behavior, and error middleware
- Next adapter handler parsing, local PUT, auth fail-closed behavior, and safe error mapping
- validation edge cases for filenames, MIME types, metadata, path prefixes, object keys, upload intents, stored object metadata, image dimensions, and policy configuration
- stream-first non-image completion path
- reusable repository contract suite, including optional repository batch update capabilities
- deletion outbox worker helper for durable, retryable object deletion
- package boundary and export-map hardening
- production integration checklist and app-facing recipes
- S3 adapter signing, streaming, delete chunking, not-found, and URL behavior
- gated S3-compatible integration harness for MinIO/S3-like services
- Sharp adapter real-image metadata, normalization, variant, enlargement, and failure behavior

## Limitations

- Built-in completion limiter is process-local. Use an external queue/distributed limiter for multi-replica production.
- Completion streams reads when providers implement `getObjectStream()`, but image processing and content inspection still require bounded buffers.
- No database implementation ships by default; use repository recipes.
- Sharp and AWS SDK are optional peer dependencies used only by explicit adapter subpaths.
- Package publishes built `dist` JavaScript and `.d.ts` files; source TypeScript is development input.
- React upload UI is outside this package by design.
