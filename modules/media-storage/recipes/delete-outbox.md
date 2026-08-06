# Delete Outbox Recipe

Default core deletion is simple and safe for many apps:

1. mark media rows deleted/failed/moved
2. delete storage objects best-effort
3. log failures

If an app needs durable retry after object-delete failures, use a deletion outbox in the same database as the app `MediaRepository` and enable `policies.objectDeletionMode: "outbox"`.

## Pattern

When `objectDeletionMode` is `"outbox"`, core calls `repository.enqueueObjectDeletions()` in the same `repository.transaction()` callback as the related media state change:

- `deleteAsset()` marks the asset deleted and enqueues original/variant keys with reason `asset_deleted`.
- `cancelUpload()` marks the upload cancelled and enqueues the pending original key with reason `upload_cancelled`.
- terminal `completeUpload()` failure marks the upload failed and enqueues the uploaded original key with reason `upload_failed`.
- `moveAssets()` updates stored keys and enqueues previous source keys with reason `move_source`.

The repository still must not call storage providers. It only writes durable outbox rows.

Core also attempts immediate best-effort deletion after the transaction commits. The outbox is idempotent safety: if the object is already gone, workers treat provider not-found as success.

## Suggested table

```txt
media_object_deletion_outbox
  id
  object_key
  reason
  asset_id
  session_id
  status          -- pending | processing | succeeded | failed
  attempts
  requested_at
  locked_until
  retry_at
  last_error
  context_json
  created_at
  updated_at
```

Recommended indexes:

```txt
(status, retry_at, requested_at)
(locked_until)
(object_key)
(asset_id)
(session_id)
```

Use a unique/idempotency key when useful, for example:

```txt
(object_key, reason, asset_id, session_id)
```

## Repository hook

Implement this optional `MediaRepository` method:

```ts
async enqueueObjectDeletions(input) {
  await db.mediaObjectDeletionOutbox.insertMany(
    input.requests.map((request) => ({
      objectKey: request.objectKey,
      reason: request.reason,
      assetId: request.assetId,
      sessionId: request.sessionId,
      requestedAt: request.requestedAt,
      contextJson: request.context,
      status: "pending",
      attempts: 0,
    }))
  )
}
```

In outbox mode, the repository must also implement `transaction()` and pass a transaction-bound repository into the callback. Core fails fast at service creation if either method is missing.

## Worker

Implement `ObjectDeletionOutbox` and run `processObjectDeletionOutbox()` from a cron/queue worker:

```ts
import { processObjectDeletionOutbox } from "@toolbox/media-storage/core"

await processObjectDeletionOutbox({
  outbox: mediaObjectDeletionOutbox,
  storage,
  limit: 100,
  lockMs: 60_000,
  retryDelayMs: 60_000,
  maxAttempts: 10,
})
```

Worker behavior:

- claims pending/expired-lock jobs
- uses provider batch delete when available
- falls back to single-object deletes
- treats not-found as success
- marks transient failures retryable until `maxAttempts`
- marks terminal failures for operator review

## Enable in service config

```ts
const media = createMediaStorage({
  repository,
  storage,
  keyStrategy,
  idGenerator,
  policies: {
    objectDeletionMode: "outbox",
  },
})
```

Core requires:

```txt
repository.transaction()
repository.enqueueObjectDeletions()
```

This keeps the media row transition and outbox insert atomic when the repository uses a real transaction-bound implementation.

## When not needed

Skip this outbox for:

- local development
- short-lived test storage
- storage buckets with lifecycle expiration good enough for orphan cleanup
- apps where DB tombstone + best-effort delete is acceptable
