# Production Integration Checklist

Use this checklist when adding `@toolbox/media-storage` to an application.

## 1. Pick entry points

Core service:

```ts
import { createMediaStorage } from "@toolbox/media-storage/core"
```

Adapters as needed:

```ts
import { createS3StorageProvider } from "@toolbox/media-storage/adapters/s3"
import { createLocalStorageProvider } from "@toolbox/media-storage/adapters/local"
import { createSharpImageProcessor } from "@toolbox/media-storage/adapters/sharp"
import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"
import { createExpressMediaAdapter } from "@toolbox/media-storage/adapters/express"
import { createNextMediaRouteHandlers } from "@toolbox/media-storage/adapters/next"
```

## 2. Implement repository

Implement `MediaRepository` for the app database. Required guarantees:

- `claimUploadForProcessing()` is atomic.
- `completeUpload()` is transactional.
- `releaseUploadClaim()` exists when retryable completion failures should be retried safely.
- `findCleanupCandidates()` only returns rows safe to clean.
- `transaction()` is exposed when the database supports it.

Recommended optional batch methods:

- `markAssetsDeleted()` for cleanup-heavy paths.
- `updateAssetObjectKeysBatch()` for bulk move paths.

Validate with:

```ts
import { createMediaRepositoryContractSuite } from "@toolbox/media-storage/testing"

createMediaRepositoryContractSuite({ describe, it }, harness)
```

## 3. Configure storage provider

For S3-compatible production, prefer presigned POST:

```ts
const storage = createS3StorageProvider({
  bucket,
  publicUrl,
  endpoint,
  region,
  credentials,
  forcePathStyle,
  uploadTargetMode: "post",
})
```

Then require hard upload-size enforcement:

```ts
policies: {
  requireExactUploadSizeEnforcement: true,
}
```

For local development, use `createLocalStorageProvider()` and wire a signed PUT route with `createNextLocalPutObjectHandler()` or an equivalent framework handler.

## 4. Configure content and image processing

Use Sharp when image kinds need dimensions or variants:

```ts
imageProcessor: createSharpImageProcessor({
  normalizeMimeTypes: ["image/heic", "image/heif"],
})
```

Use the basic inspector at minimum for hostile/untrusted uploads:

```ts
contentInspector: createBasicContentInspector()
```

Provide a stricter `ContentInspector` for antivirus scanning, PDF/SVG hardening, archive rules, or app-specific policy.

## 5. Configure policies

Set explicit policies per app:

- `allowedMimeTypesByKind`
- `maxSizeByKind`
- `pathPrefixes.allowedPrefixes`
- `uploadSessionTtlMs`
- `presignedUploadTtlMs`
- `orphanTtlMs`
- `maxDownloadUrlExpirySeconds`
- `maxCompletionBufferBytes`
- `deletionMode`
- `isImageKind` for app-specific image kinds such as `avatar`, `photo`, or `document-preview`
- `metadata` limits and allowed keys

## 6. Configure auth and usage hooks

Framework adapters fail closed. Always configure `authorize` unless an action is intentionally public.

Use `actorPolicy` for service-level authorization:

- create
- complete
- cancel
- read/list
- delete
- move

Use `assetUsagePolicy` to protect assets referenced by app tables.

## 7. Decide deletion mode

Default core object deletion is best-effort after DB state changes.

If the app needs durable object-delete retry:

1. Set `policies.objectDeletionMode: "outbox"`.
2. Implement `repository.transaction()`.
3. Implement `repository.enqueueObjectDeletions()` to write durable rows in the same transaction as media state changes.
4. Implement `ObjectDeletionOutbox` for the worker.
5. Run:

```ts
import { processObjectDeletionOutbox } from "@toolbox/media-storage/core"

await processObjectDeletionOutbox({ outbox, storage })
```

See [`delete-outbox.md`](./delete-outbox.md).

## 8. Wire framework routes

Use framework adapters or preserve existing routes and call the service directly.

Express:

```ts
const handlers = createExpressMediaAdapter({ media, getActorId, authorize })
```

Next/App Router:

```ts
const handlers = createNextMediaRouteHandlers({ media, getActorId, authorize })
```

Keep response envelopes stable for existing clients if migrating an app.

## 9. Update client upload flow

Upload targets may be PUT or POST.

- PUT: send file body to `uploadUrl` with returned `headers`.
- POST: submit `fields` plus file as `multipart/form-data` to `uploadUrl`.

After direct upload, call completion endpoint with `sessionId` and optional checksum.

## 10. Validate

Run module validation:

```sh
pnpm --filter @toolbox/media-storage typecheck
pnpm --filter @toolbox/media-storage build
pnpm --filter @toolbox/media-storage test
pnpm --filter @toolbox/media-storage lint
pnpm --filter @toolbox/media-storage pack:dry-run
```

Run optional S3-compatible integration:

```sh
docker compose -f modules/media-storage/integration/s3-compatible/docker-compose.yml up -d
pnpm --filter @toolbox/media-storage test:integration:s3
```

Run app validation:

- repository contract suite
- existing route tests
- browser direct-upload flow
- image variant checks
- delete/cancel/cleanup checks
- move workflow checks
- rollback/failure tests

## 11. Roll out

Recommended production rollout:

1. ship behind feature flag
2. dual-run repository contract tests in CI
3. test on staging bucket/container
4. enable for low-risk asset kind
5. monitor failed uploads, cleanup failures, outbox retries, and storage 4xx/5xx
6. migrate remaining asset kinds
7. remove old workflow code only after parity
