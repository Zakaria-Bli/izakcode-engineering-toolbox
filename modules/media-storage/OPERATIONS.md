# Media Storage Operations Guide

Status: production-ready operational guidance.

This guide covers runtime setup, observability, scheduled jobs, incident handling, and production rollout for apps using `@toolbox/media-storage`.

## Production deployment checklist

Before enabling traffic:

- [ ] Repository adapter passes `createMediaRepositoryContractSuite()`.
- [ ] Storage provider declares truthful capabilities.
- [ ] S3 production uses `uploadTargetMode: "post"` and `requireExactUploadSizeEnforcement: true` when strict pre-storage size rejection is required.
- [ ] Content inspector is configured for untrusted uploads.
- [ ] Image processor is configured for every image kind.
- [ ] Framework routes enforce app auth and adapter `authorize` hooks.
- [ ] Cleanup endpoint/job is authenticated and rate-limited.
- [ ] `policies.objectDeletionMode: "outbox"` is enabled if durable delete retry is required.
- [ ] Repository implements `transaction()` and `enqueueObjectDeletions()` when outbox mode is enabled.
- [ ] Object deletion outbox worker runs and is monitored when outbox mode is enabled.
- [ ] Bucket/container lifecycle rules are documented.
- [ ] Monitoring and alerts exist for failed completions, storage errors, cleanup failures, and outbox backlog.
- [ ] Feature flag or low-risk kind rollout plan is ready.

## Infrastructure

### Object storage

Recommended production bucket/container properties:

- private writes through signed upload targets
- public reads only through CDN/public base if app policy permits
- CORS allowing the exact upload methods/headers clients use
- server-side encryption when available
- versioning or backups according to app recovery policy
- lifecycle rules for unreferenced temporary prefixes if compatible with app cleanup logic
- logs/audit trails for PUT, GET, COPY, DELETE where provider supports them

S3-compatible CORS for PUT-style clients usually needs:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "POST", "GET"],
    "AllowedHeaders": ["content-type", "content-length", "x-amz-*"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3000
  }
]
```

For presigned POST, include whatever fields/headers your provider requires. Validate CORS in a browser, not only with curl.

### Database

Recommended tables:

- media assets
- media asset variants
- media upload sessions
- optional object deletion outbox

Recommended indexes are listed in [`recipes/repositories.md`](./recipes/repositories.md). Keep session status and asset status indexed for completion and cleanup.

### Workers and schedules

Run cleanup periodically:

```ts
await media.cleanup({ limit: 100 })
```

Run outbox processing when using durable deletes:

```ts
await processObjectDeletionOutbox({ outbox, storage, batchSize: 100 })
```

Suggested intervals:

| Job                          | Typical interval                  | Notes                                                 |
| ---------------------------- | --------------------------------- | ----------------------------------------------------- |
| cleanup                      | every 5-30 minutes                | Tune by upload volume and orphan TTL.                 |
| object deletion outbox       | every 1-5 minutes or queue-driven | Alert on backlog age.                                 |
| storage audit/reconciliation | daily/weekly                      | Optional; compare DB ready/deleted rows with objects. |

Use one active worker per shard/tenant or make jobs idempotent with database locks. The core cleanup flow is safe to retry, but duplicate workers can waste provider calls.

## Observability

### Logs

Log these events at app boundary or via `logger`:

- upload intent created: asset ID, session ID, kind, size, MIME, actor, object key
- completion started/claimed/completed/failed
- content mismatch and checksum mismatch
- image processing failures
- storage provider errors with operation and provider name
- cleanup plan/result counts
- delete/move failures and compensation attempts
- outbox process result counts

Do not log raw file contents, full signed URLs, secrets, credentials, or untrusted metadata without redaction.

### Metrics

Recommended counters:

```txt
media_upload_intent_created_total{kind}
media_upload_complete_total{kind,status}
media_upload_complete_duration_ms{kind}
media_upload_failed_total{kind,code}
media_upload_cancelled_total{kind}
media_asset_deleted_total{kind}
media_cleanup_runs_total{status}
media_cleanup_objects_deleted_total
media_cleanup_objects_failed_total
media_move_total{status}
media_storage_operations_total{provider,operation,status}
media_outbox_processed_total{status}
```

Recommended gauges:

```txt
media_upload_sessions_awaiting
media_upload_sessions_processing
media_assets_pending_upload
media_assets_processing
media_outbox_pending
media_outbox_oldest_age_seconds
media_completion_queue_depth
```

### Alerts

Alert on:

- sustained `STORAGE_PROVIDER_ERROR` rate
- completion failures above baseline
- uploads stuck in `processing` longer than expected completion time
- outbox oldest pending age beyond retry SLO
- cleanup failed object count above zero for multiple runs
- sudden increase in `CONTENT_MISMATCH` or `CHECKSUM_MISMATCH`
- local/S3 disk/bucket capacity nearing limit

## Security operations

### Signed upload targets

- Keep TTL short (`presignedUploadTtlMs` usually 5-15 minutes).
- Prefer S3 POST when hard size enforcement matters.
- Completion must always be called after client upload; direct object creation alone never makes an asset ready.
- Treat signed URLs as credentials; avoid logging them.

### Authorization

- Framework adapters fail closed unless `authorize` exists or an action is explicitly listed in `allowUnauthenticated`.
- Keep cleanup/delete/move behind stronger permissions than upload intent creation.
- Use `actorPolicy` for service-level ownership checks so custom routes and framework adapters share rules.
- Use `assetUsagePolicy` to block deletion of referenced objects.

### Content safety

- Configure MIME allow-lists per kind.
- Use `createBasicContentInspector()` at minimum for untrusted uploads.
- Add antivirus or sandbox scanning through a custom `ContentInspector` when accepting documents/archives or when compliance requires it.
- Do not allow SVG unless the app has a sanitization/rendering policy.

## Data lifecycle

### Upload lifecycle

```txt
createUploadIntent -> pending asset + awaiting session
client direct upload -> object exists but asset not ready
completeUpload -> processing claim -> validation/inspection/variants -> ready asset
cancel/expire/fail -> terminal non-ready state and best-effort cleanup
```

### Delete lifecycle

Default service deletion:

```txt
authorize -> usage check -> mark asset deleted -> best-effort delete objects
```

Durable outbox mode:

```txt
repository transaction marks asset deleted/failed/cancelled/moved and enqueues object keys
core attempts immediate best-effort delete after commit
worker retries provider deletion until success/not-found
```

### Cleanup lifecycle

```txt
repository returns expired/stale candidates
assetUsagePolicy filters in-use candidates
provider deletes objects
repository expires sessions and marks assets deleted only for fully deleted/missing object sets
```

## Rollout strategy

Recommended sequence:

1. Add repository contract tests in CI.
2. Add toolbox service behind a feature flag.
3. Preserve existing route paths and response envelopes.
4. Enable in staging against a non-production bucket/container.
5. Test browser PUT/POST upload, complete, cancel, delete, cleanup, and failure cases.
6. Enable one low-risk kind or small actor group.
7. Monitor errors, queue depth, cleanup, and outbox.
8. Expand rollout.
9. Remove legacy workflow only after parity and rollback window.

## Rollback strategy

A feature-flagged integration should allow immediate fallback to legacy workflow for new requests.

Before rollback, consider:

- Pending sessions created by toolbox may have different object keys than legacy sessions.
- Ready assets written by toolbox should use the same app schema and response shape if migration was done correctly.
- Cleanup/outbox workers should be paused only if they might conflict with legacy deletion logic.

Keep old code path until no active upload sessions from the new path remain or both paths can complete each other's sessions.

## Backup and recovery

Back up:

- media asset rows
- media variant rows
- upload session rows while sessions can complete
- object deletion outbox rows
- object storage bucket/container according to app RPO/RTO

Recovery checks:

- DB ready asset object keys exist in storage.
- Variant rows match variant objects.
- Deleted assets either have no objects or pending outbox entries.
- Awaiting/processing sessions older than TTL are eligible for cleanup.

## Runbooks

### Upload completions failing with `STORAGE_PROVIDER_ERROR`

1. Check provider health, credentials, DNS, and bucket policy.
2. Inspect operation in error details (`headObject`, `getObjectBuffer`, `putObject`, `deleteObject`, etc.).
3. If transient, raise `retryPolicy.maxAttempts` for completion path and ensure `releaseUploadClaim()` exists.
4. Re-run completion for sessions still awaiting/processing if app supports retry.
5. Run cleanup after provider recovers.

### Assets stuck in `processing`

1. Find sessions/assets in processing beyond normal duration.
2. Check whether app crashed during completion.
3. If repository supports claim release, release to awaiting and retry completion.
4. Otherwise mark failed/expired according to app recovery policy and run cleanup.

### Cleanup repeatedly fails

1. Inspect failed object keys and provider error codes.
2. Verify keys are valid and provider credentials include delete permission.
3. Confirm bucket lifecycle/versioning is not blocking delete.
4. For durable retry, enqueue keys in deletion outbox.
5. Keep DB records unchanged until object delete succeeds/missing, unless app accepts best-effort deletion.

### Outbox backlog grows

1. Verify worker schedule is running.
2. Check provider delete permissions and rate limits.
3. Increase batch size/concurrency carefully.
4. Alert if oldest pending age violates SLO.
5. Treat provider not-found as success.

### Browser upload fails before completion

1. Check CORS for method, origin, and headers.
2. Confirm client sends all returned headers/fields.
3. For POST, ensure form includes every `fields` entry and then the file field.
4. Confirm upload URL did not expire.
5. Check provider-specific limits for object size and metadata.

## Release validation commands

From repository root:

```sh
pnpm --filter @toolbox/media-storage typecheck
pnpm --filter @toolbox/media-storage build
pnpm --filter @toolbox/media-storage test
pnpm --filter @toolbox/media-storage lint
pnpm --filter @toolbox/media-storage pack:dry-run
```

Optional S3-compatible integration:

```sh
docker compose -f modules/media-storage/integration/s3-compatible/docker-compose.yml up -d
pnpm --filter @toolbox/media-storage test:integration:s3
```
