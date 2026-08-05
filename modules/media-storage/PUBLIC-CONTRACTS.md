# Media Storage Public Contracts

Status: production-ready contract freeze.

This document distinguishes stable API surfaces from experimental extension points. Stable APIs may still evolve before a 1.0 package release, but changes should be deliberate, documented, and covered by tests/migration notes.

For method shapes and option details, see [`API-REFERENCE.md`](./API-REFERENCE.md). For adapter-specific behavior, see [`ADAPTERS.md`](./ADAPTERS.md).

## Stability levels

- **Stable**: intended for app integrations and copy-paste reuse now.
- **Experimental**: available for early integrations, but shape may change during production hardening.
- **Adapter-specific**: public from an adapter subpath, not part of core domain guarantees.
- **Deprecated**: kept for compatibility; prefer replacement.

## Stable root/core exports

Stable for app integrations:

- `createMediaStorage(config)`
- `MediaStorageService`
- `MediaStorageConfig`
- `MediaStorageRetryPolicy`
- `MediaStorageActorPolicy`
- `MediaStoragePolicies`
- `defaultMediaStoragePolicies`
- `mergeMediaStoragePolicies`
- `createPrefixKeyStrategy()`
- `createDatePartitionedKeyStrategy()`
- `createInMemoryCompletionLimiter()`
- `processObjectDeletionOutbox()`
- validation helpers exported from `core` for repository/adapters/tests

Stable service methods:

- `createUploadIntent()`
- `completeUpload()`
- `cancelUpload()`
- `getAsset()`
- `listAssets()`
- `getDownloadUrl()`
- `deleteAsset()`
- `moveAssets()`
- `planCleanup()`
- `cleanup()`

## Stable domain exports

Stable domain contracts:

- `MediaAsset`
- `MediaAssetVariant`
- `MediaUploadSession`
- `MediaUploadRecord`
- `MediaAssetWithVariants`
- `UploadIntent`
- `CompleteUploadResult`
- input/result DTOs in `domain/types.ts`
- `MediaAssetStatus`
- `MediaUploadSessionStatus`
- `DefaultMediaAssetKind`
- `MediaStorageError` hierarchy and `isMediaStorageError()`

Error contracts are considered stable by `code`, `status`, `expose`, and `retryable`. Exact error messages may change and should not be parsed by integrations.

## Stable testing exports

- `createMediaRepositoryContractSuite()` from `@toolbox/media-storage/testing`
- `MediaRepositoryContractHarness`
- `MediaRepositoryContractRunner`

Use these to validate app-specific repository adapters against the core lifecycle contract.

## Stable port exports

Stable ports for applications to implement:

- `MediaRepository`
- `ObjectStorageProvider` core object methods
- `ImageProcessor`
- `ObjectKeyStrategy`
- `CompletionLimiter`
- `Clock`
- `IdGenerator`
- `Logger`
- `ContentInspector`
- `ObjectDeletionOutbox`
- `MediaAssetUsagePolicy`

## Stable operational helpers

- `processObjectDeletionOutbox()` from `@toolbox/media-storage/core`
- `ObjectDeletionOutbox` from `@toolbox/media-storage/ports`

These provide an optional durable object-delete retry pattern. They do not change default service deletion behavior; apps opt in by writing outbox rows from their repository/database layer and running a worker.

## Experimental provider capabilities

These are intentionally available now but may change as stream/multipart hardening lands:

- `ObjectStorageProvider.createUploadTarget()` for provider-neutral direct upload targets
- `ObjectStorageProvider.getObjectStream()`
- `ObjectStorageProvider.putObjectStream()`
- multipart methods:
  - `createMultipartUpload()`
  - `createMultipartPartUrl()`
  - `completeMultipartUpload()`
  - `abortMultipartUpload()`
- `StorageProviderCapabilities`

Reason: these are the right direction for production scalability and provider interoperability. Core uses streaming reads for completion when available and S3 POST for exact upload-size enforcement when configured, but stream-native image processing/content inspection and multipart workflows are not complete yet.

## Deprecated / compatibility surfaces

- `ObjectStorageProvider.createPresignedPutUrl()` remains supported for simple PUT-based providers.
- Prefer `createUploadTarget()` for new providers so POST/SAS/provider-specific upload mechanisms can fit without new core methods.
- `S3StorageProviderConfig.uploadHeaders` is deprecated. Prefer typed `uploadOptions` so command options are represented in signed S3 requests.

## Adapter-specific contracts

Adapter subpaths are public but scoped to their adapter:

- `@toolbox/media-storage/adapters/s3`
- `@toolbox/media-storage/adapters/local`
- `@toolbox/media-storage/adapters/sharp`
- `@toolbox/media-storage/adapters/content-inspector`
- `@toolbox/media-storage/adapters/express`
- `@toolbox/media-storage/adapters/next`

Adapter factories are stable for application integrations. Adapter implementation details, private helper functions, and framework-like shim types may change before package release.

## Repository implementation contract

Production repository adapters must guarantee:

- `claimUploadForProcessing()` is atomic and returns `false` if already claimed or invalid state.
- `completeUpload()` is transactional: mark asset ready, persist checksum/dimensions/public URL, insert variants, mark session completed.
- `failUpload()` and `expireUpload()` are safe to call after partial state changes and should not throw for already-transitioned state unless the database failed.
- `releaseUploadClaim()` should restore awaiting/pending state only for processing rows belonging to the same session/asset.
- `transaction()` must pass a repository bound to the active transaction; callbacks should use the repository argument, not close over an outer repository.
- `findCleanupCandidates()` must only return records the repository is prepared to mark cleaned/deleted after object deletion.
- Optional `markAssetsDeleted()` and `updateAssetObjectKeysBatch()` should be transactional/bulk equivalents of their single-row methods. Core uses them when implemented and falls back otherwise.
- Optional `enqueueObjectDeletions()` should write durable outbox rows consumed by `processObjectDeletionOutbox()`. It is required when `policies.objectDeletionMode` is `"outbox"` and should run through the transaction-bound repository passed to `transaction()`.

## Storage provider implementation contract

Production storage providers must guarantee:

- validate all object keys with `assertValidObjectKey()` or equivalent restrictions.
- return `null` from `headObject()` for not-found objects.
- treat `deleteObject()` not-found errors as distinguishable via `isObjectNotFoundError()` when possible.
- return accurate `contentType` and `contentLength` when the provider exposes them.
- honor `AbortSignal` for remote I/O when SDK/runtime supports it.
- declare capabilities truthfully.
- document whether direct upload targets enforce exact content length before object creation.

## Framework adapter contract

Framework adapters fail closed unless:

- `authorize` is configured; or
- action is explicitly listed in `allowUnauthenticated`.

Express handlers call `next(error)` and require `createExpressMediaErrorMiddleware()` or equivalent app middleware. Next handlers catch and map errors internally.

## Versioning expectations before 1.0

Until the package is published as a versioned production dependency:

- breaking contract changes must update this document, README, recipes, and tests.
- app integrations should pin a commit or workspace version.
- experimental methods may change shape.

After 1.0:

- stable APIs require semver-major for breaking changes.
- experimental capabilities may still change under documented experimental policy.
