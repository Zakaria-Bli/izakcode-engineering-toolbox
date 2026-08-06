# Media Storage Troubleshooting

Status: production-ready troubleshooting guide.

Use this guide to map symptoms and `MediaStorageError.code` values to likely causes and fixes.

## Error-code quick reference

| Code                           | Usual cause                                                                                                | Fix                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `INVALID_REQUEST`              | Missing body fields, bad metadata, bad cleanup limit, stored object missing/bad metadata.                  | Validate route payload; inspect `details`; verify object exists before completion. |
| `INVALID_OBJECT_KEY`           | Generated or provided object key has traversal, absolute path, backslash, empty segments, or unsafe shape. | Fix key strategy or prefix policy; validate with `assertValidObjectKey()`.         |
| `ACCESS_DENIED`                | Missing adapter `authorize`, actor not allowed by `actorPolicy`, or app auth failed.                       | Configure `authorize`; check actor resolution and ownership policy.                |
| `UNSUPPORTED_MIME_TYPE`        | MIME not listed in `allowedMimeTypesByKind[kind]`.                                                         | Add MIME to policy only if app supports and inspects it.                           |
| `FILE_TOO_LARGE`               | Declared size exceeds `maxSizeByKind[kind]`.                                                               | Reject in UI or raise policy limit after capacity review.                          |
| `UPLOAD_SESSION_NOT_FOUND`     | Bad session ID, deleted session, or app route parsed wrong parameter.                                      | Check route params and repository lookup.                                          |
| `UPLOAD_SESSION_EXPIRED`       | Completion happened after `uploadSessionTtlMs`.                                                            | Ask client to create a new upload intent; tune TTL if needed.                      |
| `UPLOAD_SESSION_INVALID_STATE` | Duplicate completion/cancel, non-atomic claim race, invalid repository transition.                         | Confirm idempotency path and atomic `claimUploadForProcessing()`.                  |
| `ASSET_NOT_FOUND`              | Bad asset ID or deleted asset.                                                                             | Check ID parsing, repository read filters, and deletion state.                     |
| `ASSET_IN_USE`                 | `assetUsagePolicy` found references.                                                                       | Remove references first or adjust usage policy if false positive.                  |
| `CHECKSUM_MISMATCH`            | Optional client checksum differs from computed SHA-256.                                                    | Re-upload; ensure checksum is SHA-256 of uploaded bytes.                           |
| `CONTENT_MISMATCH`             | Content inspector detected magic-byte mismatch.                                                            | Reject file; verify client MIME and inspector aliases.                             |
| `IMAGE_PROCESSING_FAILED`      | Sharp cannot decode/process image or variant config invalid for source.                                    | Check image bytes, HEIC support, dimensions, and variant settings.                 |
| `STORAGE_PROVIDER_ERROR`       | Provider SDK/network/permission/bucket failure.                                                            | Inspect operation/provider details; check credentials, bucket policy, network.     |
| `RATE_LIMIT_EXCEEDED`          | Completion limiter queue full or timeout.                                                                  | Increase limiter, scale workers, or retry later.                                   |
| `UPLOAD_ABORTED`               | Request/client aborted completion signal.                                                                  | Retry completion if session can be released or remains valid.                      |
| `CONFIGURATION_ERROR`          | Bad factory config or policy values.                                                                       | Validate required provider/policy values at startup.                               |
| `CAPABILITY_NOT_SUPPORTED`     | Workflow needs provider capability such as copy or signed get.                                             | Implement provider method or disable workflow.                                     |

## Upload intent problems

### `UNSUPPORTED_MIME_TYPE`

Checklist:

- `kind` matches the keys in `allowedMimeTypesByKind` exactly.
- `normalizeMimeType` output matches policy values.
- Browser-provided MIME is not empty or vendor-specific.
- App supports the file type in content inspection and downstream rendering.

### `FILE_TOO_LARGE`

Checklist:

- UI limit matches `maxSizeByKind`.
- Reverse proxy/body-parser limits do not conflict with direct upload completion endpoints.
- S3 POST policy and app policy use same exact byte count.

### S3 POST upload fails in browser

Checklist:

- Client sends `multipart/form-data` to `uploadUrl`.
- Every returned `fields` key/value is included before the file field.
- Bucket CORS allows `POST` from the app origin.
- Object size matches the signed `content-length-range` condition exactly when strict enforcement is enabled.
- Upload target has not expired.

### S3 PUT upload fails in browser

Checklist:

- Client uses `PUT`, not `POST`.
- Client includes every returned header, especially `Content-Type`.
- Bucket CORS allows `PUT` and the returned headers.
- Upload target has not expired.

## Completion problems

### Object not found during completion

Likely causes:

- Client never uploaded to the signed target.
- Client uploaded after URL expiration and provider rejected it.
- Object key mismatch in repository adapter.
- App is completing a session from another environment/bucket.

Fix:

1. Inspect `record.session.objectKey`.
2. Check provider console/API for object existence.
3. Verify create intent response is the one the client used.
4. Verify app/staging/prod bucket configuration.

### Object type or size mismatch

Likely causes:

- Client uploaded different file than declared.
- Browser or library changed content type.
- Provider metadata omits or normalizes content type differently.
- Repository stored expected values incorrectly.

Fix:

1. Compare `record.session.expectedMime` and provider `headObject().contentType`.
2. Compare `record.session.expectedSize` and provider `headObject().contentLength`.
3. Ensure direct upload includes signed/required content-type headers.
4. Keep completion metadata validation enabled; do not trust create-intent payload alone.

### Duplicate completion race

Expected behavior:

- If already completed, core returns completed asset with variants.
- If two requests claim concurrently, exactly one should process.

If both process:

- `repository.claimUploadForProcessing()` is not atomic.
- Fix DB transition to update only `awaiting` rows and return affected-row count.

### Completion fails after writing variants

Expected behavior:

- Core deletes partial variant objects best-effort.
- Repository should mark upload failed for terminal non-retryable errors.

Check:

- Provider delete permission.
- Variant object keys generated by key strategy.
- Failure reason stored by repository.
- Cleanup job catches leftovers.

## Image problems

### HEIC/HEIF upload fails

Checklist:

- MIME allow-list includes `image/heic` and/or `image/heif`.
- `createSharpImageProcessor({ normalizeMimeTypes: ["image/heic", "image/heif"] })` or custom processor is configured.
- Runtime Sharp/libvips build supports the source format or app provides custom conversion.
- Content inspector recognizes HEIC/HEIF brands or aliases are configured.

### Image dimensions rejected

Checklist:

- Check `policies.imageDimensionLimits`.
- Verify normalization does not alter dimensions unexpectedly.
- Confirm source is not corrupt/truncated.

### Variants look cropped/wrong

Checklist:

- Variants with `height` use crop-like resizing (`fit` default `cover`).
- Variants without `height` preserve aspect ratio (`fit` default `inside`).
- Set `withoutEnlargement: true` for non-upscaling variants.

## Delete, move, and cleanup problems

### `ASSET_IN_USE`

Likely cause: `assetUsagePolicy` reports references.

Fix:

- Inspect `details` returned by the policy.
- Remove rows from app tables before deleting media.
- Keep usage checks outside repository port so rules are visible in service config.

### Move fails with missing capability

`moveAssets()` requires storage `copyObject()` support. S3 and local adapters support it. Custom providers must implement it or the app must avoid move workflows.

### Move copied targets but DB update failed

Expected behavior: core rolls back copied targets before returning error.

Check:

- Provider delete permission for target keys.
- Logs for rollback delete failures.
- Cleanup/outbox if rollback could not delete all copied targets.

### Cleanup does not delete some candidates

Expected behavior:

- In-use assets are skipped.
- Items with any failed object delete are not marked cleaned/deleted.

Check:

- `assetUsagePolicy` details.
- Provider delete errors.
- Candidate query in `findCleanupCandidates()`.
- `orphanTtlMs` and cleanup `limit`.

### Outbox mode fails at service creation

`policies.objectDeletionMode: "outbox"` requires:

```txt
repository.transaction()
repository.enqueueObjectDeletions()
```

Implement both on the same database adapter so core can write media state changes and outbox rows in one transaction.

### Outbox backlog grows

1. Verify worker schedule is running.
2. Check provider delete permissions and rate limits.
3. Increase batch size/concurrency carefully.
4. Alert if oldest pending age violates SLO.
5. Treat provider not-found as success.

## Adapter problems

### Express returns unhandled errors

Fix:

- Mount `createExpressMediaErrorMiddleware()` after media routes, or map `MediaStorageError` in app error middleware.
- Ensure async route wrappers call `next(error)`.

### Next returns generic `Request failed.`

Expected for internal errors where `error.expose === false`.

Fix:

- Log full error server-side.
- Override `errorResponse` only if you keep non-exposed details hidden from clients.

### Adapter always denies requests

Framework adapters fail closed by design.

Fix:

- Provide `authorize` callback; or
- explicitly list safe public actions in `allowUnauthenticated`.

Do not allow unauthenticated `cleanup`, `deleteAsset`, or `moveAssets`.

## Repository problems

### Contract suite fails transaction callback test

Likely cause: `transaction(task)` calls `task(this)` instead of a repository bound to the transaction.

Fix: instantiate/pass a transaction-scoped repository inside the DB transaction callback.

### Contract suite fails optional batch behavior

Optional batch methods must be exact bulk equivalents of single-row methods:

- `markAssetsDeleted()` = repeated `markAssetDeleted()` in one transaction.
- `updateAssetObjectKeysBatch()` = repeated `updateAssetObjectKeys()` in one transaction.

If this is not true, omit the optional method and let core fall back.

### Failed uploads throw from `failUpload()`

`failUpload()` should be best-effort safe for pending/processing rows. It should not throw only because the row has already transitioned; throw only for real database failure.

## Packaging/import problems

### Runtime cannot resolve adapter subpath

Checklist:

- Run `pnpm --filter @toolbox/media-storage build` before consuming package export map locally.
- Import from documented subpaths, not `src/*`.
- Ensure optional peer dependency is installed for heavy adapter (`sharp` or AWS SDK packages).

### Core bundle pulls Sharp/AWS SDK

This should not happen when importing only root/core/domain/ports. Check imports for adapter subpaths. Package boundary tests enforce this.

## Debug commands

```sh
pnpm --filter @toolbox/media-storage typecheck
pnpm --filter @toolbox/media-storage test
pnpm --filter @toolbox/media-storage lint
pnpm --filter @toolbox/media-storage pack:dry-run
```

Targeted package contents check:

```sh
pnpm --filter @toolbox/media-storage pack:dry-run
```

S3-compatible check:

```sh
docker compose -f modules/media-storage/integration/s3-compatible/docker-compose.yml up -d
pnpm --filter @toolbox/media-storage test:integration:s3
```
