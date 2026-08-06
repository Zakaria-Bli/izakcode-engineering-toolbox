# Repository Recipes

`@toolbox/media-storage` does not ship one mandatory database schema. Applications implement the `MediaRepository` port for their database and ID strategy.

## Contract tests

Use the reusable contract suite against every concrete repository adapter:

```ts
import { describe, it } from "vitest"
import { createMediaRepositoryContractSuite } from "@toolbox/media-storage/testing"

createMediaRepositoryContractSuite(
  { describe, it },
  {
    createRepository: () => createAppMediaRepository(testDb),
    cleanupRepository: async () => resetMediaTables(testDb),
    kind: "image",
    actorId: "actor-1",
    createAssetId: (seed) => crypto.randomUUID(), // omit for DB-generated IDs
  }
)
```

The suite checks core state-transition guarantees: create/find, atomic claim, complete with variants, release claim when implemented, fail/expire/cancel/delete states, move key updates, batch session expiry, optional repository batch methods, and transaction callback behavior.

## Required persistence concepts

A repository implementation must persist:

- media assets
- media asset variants
- media upload sessions
- optional object-deletion outbox rows for durable delete retry

See [`delete-outbox.md`](./delete-outbox.md) for the outbox pattern.

Minimum asset columns:

```txt
id
kind
status
provider
bucket
object_key
public_url
original_filename
mime_type
size
checksum
width
height
owner_id
failure_reason
created_at
updated_at
deleted_at
metadata
```

Minimum variant columns:

```txt
id
asset_id
variant_type
object_key
public_url
width
height
format
size
created_at
metadata
```

Minimum upload session columns:

```txt
id
asset_id
expected_mime
expected_size
object_key
expires_at
status
created_at
updated_at
completed_at
```

## Important repository guarantees

### `claimUploadForProcessing()` must be atomic

It should update only if current state is valid:

```sql
UPDATE upload_sessions
SET status = 'processing', updated_at = ?
WHERE id = ? AND status = 'awaiting';

UPDATE media_assets
SET status = 'processing', updated_at = ?
WHERE id = ? AND status = 'pending_upload';
```

Return `false` if the session was already claimed.

### `completeUpload()` should be transactional

Within one transaction:

- mark asset ready
- set checksum, dimensions, public URL
- insert variants
- mark session completed

### `failUpload()` should be best-effort safe

It should mark pending/processing assets and awaiting/processing sessions as failed. It should not throw because state already changed unless the database itself failed.

### Optional batch methods are recommended for cleanup and bulk moves

Core falls back to single-row methods, but high-volume repositories should expose:

```ts
markAssetsDeleted(input: {
  assetIds: MediaId[]
  deletionMode: MediaDeletionMode
  now: Date
}): Promise<void>

updateAssetObjectKeysBatch(input: {
  updates: UpdateAssetObjectKeysInput[]
}): Promise<void>
```

`markAssetsDeleted()` should be the bulk equivalent of `markAssetDeleted()`. `updateAssetObjectKeysBatch()` should be the bulk equivalent of `updateAssetObjectKeys()`.

### `transaction()` is recommended

If the repository supports transactions, expose:

```ts
transaction<T>(task: (repository: MediaRepository) => Promise<T>): Promise<T>
```

The core uses it for move and cleanup state updates when available.

## UUID schema recipe

Use UUID asset IDs when the application creates the asset ID before insertion.

```ts
const idGenerator = {
  createAssetId: () => crypto.randomUUID(),
  createSessionId: () => crypto.randomUUID(),
  createObjectNonce: () => crypto.randomUUID(),
}
```

Works well with date-partitioned keys:

```txt
media/YYYY/MM/{assetId}/original.jpg
media/YYYY/MM/{assetId}/thumbnail.webp
```

## Integer schema recipe

Use integer asset IDs when the database owns asset IDs. In this case omit `createAssetId()` and use `sessionId` or `objectNonce` for original keys.

```ts
const idGenerator = {
  createSessionId: () => crypto.randomUUID(),
  createObjectNonce: () => crypto.randomUUID(),
}
```

Use prefix keys:

```txt
{pathPrefix}/{timestamp}-{objectNonce}.jpg
{pathPrefix}/{timestamp}-{objectNonce}-thumbnail.webp
```

The repository returns the generated integer asset ID from `createPendingUpload()`.

## Recommended indexes

```txt
media_assets(status, created_at)
media_assets(owner_id)
media_assets(object_key)
media_assets(public_url)
media_asset_variants(asset_id)
media_upload_sessions(asset_id)
media_upload_sessions(status, expires_at)
```

Use a unique index on session ID. Consider a unique index on object key.

## App-specific usage checks

Do not put application reference tables into the repository port.

Use `assetUsagePolicy`:

```ts
assetUsagePolicy: async ({ asset }) => {
  const usageCount = await countAssetReferences(asset.id)
  return { inUse: usageCount > 0, details: { usageCount } }
}
```

## Ownership and authorization

Do not enforce permissions in repository methods. Use framework adapter hooks and `actorPolicy` instead.
