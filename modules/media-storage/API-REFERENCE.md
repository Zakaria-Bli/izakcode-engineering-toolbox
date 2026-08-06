# Media Storage API Reference

Status: production-ready reference for stable `@toolbox/media-storage` APIs.

Use this file as the first stop for method shapes, option meanings, policies, and error contracts. See [`PUBLIC-CONTRACTS.md`](./PUBLIC-CONTRACTS.md) for stability rules and [`ADAPTERS.md`](./ADAPTERS.md) for adapter-specific options.

## Entry points

| Import path                                         | Purpose                                                                               | Heavy optional peers   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `@toolbox/media-storage`                            | Root re-export of core, domain, and ports                                             | none                   |
| `@toolbox/media-storage/core`                       | Service factory, policies, key strategies, limiter, outbox worker, validation helpers | none                   |
| `@toolbox/media-storage/domain`                     | Domain DTOs, states, errors                                                           | none                   |
| `@toolbox/media-storage/ports`                      | Repository/storage/image/content/runtime ports                                        | none                   |
| `@toolbox/media-storage/testing`                    | Repository contract suite                                                             | none                   |
| `@toolbox/media-storage/adapters/s3`                | AWS S3 / S3-compatible provider                                                       | AWS SDK optional peers |
| `@toolbox/media-storage/adapters/local`             | Local filesystem provider and local upload signing                                    | none                   |
| `@toolbox/media-storage/adapters/sharp`             | Sharp image processor                                                                 | `sharp` optional peer  |
| `@toolbox/media-storage/adapters/content-inspector` | Basic magic-byte inspector                                                            | none                   |
| `@toolbox/media-storage/adapters/express`           | Express-like HTTP handlers                                                            | none                   |
| `@toolbox/media-storage/adapters/next`              | Next/App-Router-like handlers and local PUT handler                                   | none                   |

## Factory

```ts
import { createMediaStorage, createPrefixKeyStrategy } from "@toolbox/media-storage/core"

const media = createMediaStorage({
  repository,
  storage,
  imageProcessor,
  contentInspector,
  keyStrategy: createPrefixKeyStrategy(),
  idGenerator,
  policies,
  actorPolicy,
  assetUsagePolicy,
})
```

### `MediaStorageConfig`

| Option             | Required                        | Description                                                                                        |
| ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `repository`       | yes                             | App implementation of `MediaRepository`. Owns persistence only.                                    |
| `storage`          | yes                             | `ObjectStorageProvider`. Owns object-store operations only.                                        |
| `keyStrategy`      | yes                             | Builds original and variant object keys.                                                           |
| `idGenerator`      | yes                             | Creates session IDs, object nonces, and optionally asset IDs.                                      |
| `imageProcessor`   | required for image kinds        | Normalizes images, extracts metadata, and creates variants.                                        |
| `contentInspector` | recommended for hostile uploads | Verifies magic bytes or runs custom scanning before readiness.                                     |
| `policies`         | optional                        | Partial override of defaults; see [Policies](#policies).                                           |
| `clock`            | optional                        | Testable clock; defaults to real time.                                                             |
| `limiter`          | optional                        | Completion concurrency limiter.                                                                    |
| `logger`           | optional                        | Structured logging sink.                                                                           |
| `retryPolicy`      | optional                        | Retry behavior for retryable storage/provider operations. Defaults to no retry (`maxAttempts: 1`). |
| `actorPolicy`      | optional                        | Service-level authorization hooks after actor resolution.                                          |
| `assetUsagePolicy` | optional                        | App reference checks used by delete and cleanup.                                                   |

Durable object deletion uses `policies.objectDeletionMode: "outbox"` plus repository `transaction()` and `enqueueObjectDeletions()`. Core writes outbox rows in the same repository transaction as delete/cancel/fail/move state updates, then still attempts immediate best-effort deletion. The worker later treats already-deleted/not-found objects as success.

### ID generator

```ts
const uuidIds = {
  createAssetId: () => crypto.randomUUID(),
  createSessionId: () => crypto.randomUUID(),
  createObjectNonce: () => crypto.randomUUID(),
}

const databaseGeneratedAssetIds = {
  createSessionId: () => crypto.randomUUID(),
  createObjectNonce: () => crypto.randomUUID(),
}
```

Use `createAssetId()` when object keys need the asset ID before the asset row exists. Omit it when the repository/database generates asset IDs in `createPendingUpload()`.

### Retry policy

| Field                | Default                                      | Notes                                      |
| -------------------- | -------------------------------------------- | ------------------------------------------ |
| `maxAttempts`        | `1`                                          | `1` means no retry.                        |
| `initialDelayMs`     | `200`                                        | Delay before first retry.                  |
| `maxDelayMs`         | `2_000`                                      | Backoff cap.                               |
| `backoffMultiplier`  | `2`                                          | Exponential backoff multiplier.            |
| `shouldRetry(input)` | retry `MediaStorageError.retryable === true` | Override for app-specific provider errors. |

If `releaseUploadClaim()` is implemented by the repository, retryable completion failures can release the processing claim before retry/exit.

## Service methods

| Method                      | Purpose                                                        | Key side effects                            |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `createUploadIntent(input)` | Create pending asset + upload session + direct upload target.  | DB insert, provider signing.                |
| `completeUpload(input)`     | Claim, validate, inspect/process, persist ready asset.         | DB state transition, provider reads/writes. |
| `cancelUpload(input)`       | Cancel awaiting upload and best-effort delete original object. | DB transition, provider delete.             |
| `getAsset(input)`           | Fetch non-deleted asset with variants.                         | none.                                       |
| `listAssets(input)`         | List assets through repository filters.                        | none.                                       |
| `getDownloadUrl(input)`     | Return public or signed URL for original/variant.              | provider signing if requested/needed.       |
| `deleteAsset(input)`        | Mark asset deleted and best-effort delete objects.             | DB transition, provider deletes.            |
| `moveAssets(input)`         | Copy objects to new prefix, update DB, delete old objects.     | provider copy/delete, DB key updates.       |
| `planCleanup(input)`        | Build cleanup plan only.                                       | none.                                       |
| `cleanup(input)`            | Delete cleanup objects, then mark records cleaned/deleted.     | provider deletes, DB transitions.           |

### `createUploadIntent(input)`

Input:

```ts
{
  filename: string
  mimeType: string
  size: number
  kind: string
  actorId?: string | number | null
  pathPrefix?: string | null
  metadata?: Record<string, unknown> | null
}
```

Result:

```ts
{
  uploadUrl: string
  headers: Record<string, string>
  fields?: Record<string, string> // present for POST-like targets
  sessionId: string
  assetId: string | number
  objectKey: string
  expiresAt: Date
}
```

Behavior:

1. Normalizes filename, MIME type, and path prefix.
2. Validates kind, MIME allow-list, max size, prefix policy, and metadata limits.
3. Calls `actorPolicy.assertCanCreateUpload()` when configured.
4. Generates object key through `keyStrategy`.
5. Creates pending asset/session through `repository.createPendingUpload()`.
6. Creates upload target through `storage.createUploadTarget()` or legacy `createPresignedPutUrl()`.

Client upload behavior:

- `method: "PUT"` providers: PUT file bytes to `uploadUrl` with returned `headers`.
- `method: "POST"` providers: submit returned `fields` plus file as `multipart/form-data` to `uploadUrl`.

### `completeUpload(input)`

Input:

```ts
{
  sessionId: string
  actorId?: string | number | null
  checksum?: string | null
  signal?: AbortSignal
}
```

Result: `MediaAssetWithVariants`.

Behavior:

1. Reads upload session and asset.
2. Applies `actorPolicy.assertCanCompleteUpload()`.
3. Fails expired sessions.
4. Atomically claims upload via `repository.claimUploadForProcessing()`.
5. Revalidates stored object metadata (`contentType`, `contentLength`).
6. Reads object stream when available; otherwise uses bounded buffer fallback.
7. Calculates SHA-256 and checks optional client checksum.
8. Runs `contentInspector` when configured.
9. Runs `imageProcessor` for configured image kinds: normalize, metadata, dimensions, variants.
10. Writes variants, then persists completion transactionally.
11. Cleans up partial variant writes on failure.

On terminal completion failure, core marks the upload failed, optionally enqueues the original object in the deletion outbox, and attempts immediate best-effort deletion. Retryable failures release the processing claim when the repository supports `releaseUploadClaim()`.

Idempotency: repeated completion of an already-completed session returns current completed asset with variants.

### `cancelUpload(input)`

Input:

```ts
{ sessionId: string, actorId?: string | number | null }
```

Behavior: authorizes actor, transitions awaiting upload to cancelled, optionally enqueues the original object in the deletion outbox, and best-effort deletes the original object. Missing storage objects are treated as success when the provider can identify not-found errors.

### `getAsset(input)` and `listAssets(input)`

```ts
await media.getAsset({ assetId, actorId })
await media.listAssets({ page, pageSize, status, kind, search, actorId })
```

Reads use `actorPolicy.assertCanReadAsset()` and `actorPolicy.assertCanListAssets()` when configured. Repository filters own app-specific search and pagination semantics.

### `getDownloadUrl(input)`

```ts
{
  assetId: string | number
  actorId?: string | number | null
  variantType?: string | null
  expiresInSeconds?: number
  responseContentDisposition?: string
  preferSignedUrl?: boolean
}
```

Result:

```ts
{
  url: string
  objectKey: string
  publicUrl: string | null
  expiresAt: Date | null
  contentType: string | null
}
```

Behavior:

- Uses public URL when available unless `preferSignedUrl` is true.
- Uses `storage.createPresignedGetUrl()` for signed downloads.
- Caps expiry by `policies.maxDownloadUrlExpirySeconds`.

### `deleteAsset(input)`

```ts
{ assetId: string | number, actorId?: string | number | null }
```

Behavior:

1. Fetches asset and variants.
2. Applies `actorPolicy.assertCanDeleteAsset()`.
3. Applies `assetUsagePolicy`; throws `AssetInUseError` when in use.
4. Marks asset deleted using configured `deletionMode`.
5. If `objectDeletionMode` is `"outbox"`, enqueues original and variant object keys in the same repository transaction.
6. Best-effort deletes original and variants immediately.

For durable deletion retry, configure `policies.objectDeletionMode: "outbox"`, implement `repository.enqueueObjectDeletions()`, and run `processObjectDeletionOutbox()`; see [`recipes/delete-outbox.md`](./recipes/delete-outbox.md).

### `moveAssets(input)`

```ts
{
  assetIds: (string | number)[]
  toPrefix: string
  actorId?: string | number | null
}
```

Result:

```ts
{
  assets: Array<{ assetId; objectKey; publicUrl; variants }>
}
```

Behavior:

1. Validates target prefix.
2. Fetches all assets with variants.
3. Applies `actorPolicy.assertCanMoveAsset()` per asset.
4. Requires storage `copyObject()` capability.
5. Checks target collisions via `headObject()`.
6. Copies all objects.
7. Updates repository keys transactionally, using `updateAssetObjectKeysBatch()` when available.
8. If `objectDeletionMode` is `"outbox"`, enqueues old source keys in the same key-update transaction.
9. Deletes source objects after DB success.
10. Rolls back copied target objects on failure before DB success.

### `planCleanup(input)` and `cleanup(input)`

```ts
await media.planCleanup({ limit })
await media.cleanup({ limit })
```

`limit` defaults to `100` and must be `1..1000`.

`planCleanup()` reads repository candidates and filters out assets that `assetUsagePolicy` marks in use.

`cleanup()` deletes planned objects first. Only after every object for an item is deleted or missing does it expire sessions and mark assets deleted. It uses repository `markAssetsDeleted()` when available and falls back to `markAssetDeleted()`.

## Policies

Defaults come from `defaultMediaStoragePolicies`. App overrides are shallow-merged by `mergeMediaStoragePolicies()`.

| Policy                              | Default                                 | Meaning                                                                                                                                                   |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedMimeTypesByKind.image`      | `image/jpeg`, `image/png`, `image/webp` | MIME allow-list per kind.                                                                                                                                 |
| `allowedMimeTypesByKind.file`       | `[]`                                    | Empty means no generic file uploads until app opts in.                                                                                                    |
| `maxSizeByKind.image`               | `10 MiB`                                | Max upload size per kind.                                                                                                                                 |
| `maxSizeByKind.file`                | `50 MiB`                                | Max upload size for file kind.                                                                                                                            |
| `uploadSessionTtlMs`                | `5 min`                                 | Session expiry.                                                                                                                                           |
| `presignedUploadTtlMs`              | `5 min`                                 | Upload target expiry.                                                                                                                                     |
| `orphanTtlMs`                       | `24 h`                                  | Age for stale cleanup candidates.                                                                                                                         |
| `pathPrefixes.allowedPrefixes`      | unset                                   | Optional allow-list for upload/move prefixes.                                                                                                             |
| `pathPrefixes.allow(prefix)`        | unset                                   | Optional predicate for upload/move prefixes.                                                                                                              |
| `imageDimensionLimits`              | min `100x100`, max `16383x16383`        | Enforced after image metadata extraction.                                                                                                                 |
| `variants`                          | thumbnail/card/full WebP                | Image variants to generate.                                                                                                                               |
| `deletionMode`                      | `tombstone`                             | Requested repository deletion behavior.                                                                                                                   |
| `objectDeletionMode`                | `best-effort`                           | `best-effort` logs storage delete failures; `outbox` durably records delete intents and requires repository `transaction()` + `enqueueObjectDeletions()`. |
| `maxDownloadUrlExpirySeconds`       | `3600`                                  | Signed download expiry cap.                                                                                                                               |
| `maxCompletionBufferBytes`          | `50 MiB`                                | Max object size for buffer-only paths.                                                                                                                    |
| `requireExactUploadSizeEnforcement` | `false`                                 | Fail fast unless provider declares exact upload-size enforcement.                                                                                         |
| `persistPublicUrl`                  | `true`                                  | Persist durable public URLs when provider supports them.                                                                                                  |
| `normalizeMimeType`                 | strips parameters, lowercases           | MIME comparison function.                                                                                                                                 |
| `isImageKind`                       | `kind === "image"`                      | Decides which kinds need image processing.                                                                                                                |
| `metadata.maxBytes`                 | `8192`                                  | JSON metadata byte limit.                                                                                                                                 |
| `metadata.maxDepth`                 | `5`                                     | JSON metadata depth limit.                                                                                                                                |
| `metadata.maxKeys`                  | `50`                                    | Recursive metadata key count limit.                                                                                                                       |
| `metadata.allowedKeys`              | unset                                   | Optional top-level metadata allow-list.                                                                                                                   |
| `metadata.validate()`               | unset                                   | Custom metadata validator.                                                                                                                                |

## Domain DTOs

Core entities use generic IDs and kinds:

```ts
MediaAsset<TAssetId, TActorId, TKind>
MediaAssetVariant<TAssetId>
MediaUploadSession<TAssetId>
MediaUploadRecord<TAssetId, TActorId, TKind>
MediaAssetWithVariants<TAssetId, TActorId, TKind>
```

Stable state strings:

```txt
asset: pending_upload | processing | ready | failed | deleted
session: awaiting | processing | completed | expired | cancelled | failed
```

## Error contract

All package errors extend `MediaStorageError` and expose stable:

```ts
{
  code: MediaStorageErrorCode
  status: number
  details?: Record<string, unknown>
  expose: boolean
  retryable: boolean
}
```

Do not parse exact error messages; use `code`, `status`, and `retryable`.

| Class                         | Code                           | Status | Retryable | Notes                                          |
| ----------------------------- | ------------------------------ | -----: | --------- | ---------------------------------------------- |
| `InvalidMediaRequestError`    | `INVALID_REQUEST`              |    400 | no        | Bad input, bad metadata, bad object metadata.  |
| `InvalidObjectKeyError`       | `INVALID_OBJECT_KEY`           |    400 | no        | Unsafe object key.                             |
| `MediaAccessDeniedError`      | `ACCESS_DENIED`                |    403 | no        | Auth/permission failure.                       |
| `UnsupportedMimeTypeError`    | `UNSUPPORTED_MIME_TYPE`        |    400 | no        | MIME not allowed for kind.                     |
| `FileTooLargeError`           | `FILE_TOO_LARGE`               |    400 | no        | Declared size exceeds policy.                  |
| `UploadSessionNotFoundError`  | `UPLOAD_SESSION_NOT_FOUND`     |    404 | no        | Missing upload session.                        |
| `UploadSessionExpiredError`   | `UPLOAD_SESSION_EXPIRED`       |    410 | no        | Upload session expired.                        |
| `UploadSessionStateError`     | `UPLOAD_SESSION_INVALID_STATE` |    409 | no        | Invalid transition or claim race.              |
| `AssetNotFoundError`          | `ASSET_NOT_FOUND`              |    404 | no        | Missing/deleted asset.                         |
| `AssetInUseError`             | `ASSET_IN_USE`                 |    409 | no        | Usage policy blocks delete/cleanup.            |
| `ChecksumMismatchError`       | `CHECKSUM_MISMATCH`            |    400 | no        | Client checksum mismatch.                      |
| `ContentMismatchError`        | `CONTENT_MISMATCH`             |    400 | no        | Content inspector mismatch.                    |
| `ImageProcessingError`        | `IMAGE_PROCESSING_FAILED`      |    422 | no        | Sharp/image adapter failed.                    |
| `StorageProviderError`        | `STORAGE_PROVIDER_ERROR`       |    502 | yes       | Provider I/O failed. Not exposed by default.   |
| `MediaRateLimitError`         | `RATE_LIMIT_EXCEEDED`          |    429 | yes       | Completion limiter rejected/queued too long.   |
| `MediaUploadAbortedError`     | `UPLOAD_ABORTED`               |    499 | yes       | AbortSignal cancelled completion.              |
| `MediaConfigurationError`     | `CONFIGURATION_ERROR`          |    500 | no        | Bad factory/policy config.                     |
| `CapabilityNotSupportedError` | `CAPABILITY_NOT_SUPPORTED`     |    501 | no        | Workflow requires missing provider capability. |

## Validation helpers

Stable helpers exported from `core` for adapters/tests:

- `normalizeFilename()`
- `defaultNormalizeMimeType()`
- `normalizePathPrefix()`
- `validateMetadata()`
- `assertAllowedPathPrefix()`
- `validateCreateUploadIntentInput()`
- `validateStoredObjectMetadata()`
- `validateImageMetadata()`
- `validateMediaStoragePolicies()`
- `truncateFailureReason()`

Use `assertValidObjectKey()` from `ports` for provider/repository object-key validation.
