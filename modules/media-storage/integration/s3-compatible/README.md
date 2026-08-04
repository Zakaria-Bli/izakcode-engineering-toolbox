# S3-Compatible Integration Harness

Status: optional gated integration harness for MinIO/S3-like object stores.

This harness validates `createS3StorageProvider()` against a real S3-compatible endpoint. It is skipped by default and runs only when `MEDIA_STORAGE_S3_INTEGRATION=1` is set.

## Start local MinIO

```sh
docker compose -f modules/media-storage/integration/s3-compatible/docker-compose.yml up -d
```

Default endpoint and credentials:

```txt
endpoint: http://127.0.0.1:9000
console:  http://127.0.0.1:9001
access:   minioadmin
secret:   minioadmin
```

## Run integration test

```sh
MEDIA_STORAGE_S3_INTEGRATION=1 pnpm --filter @toolbox/media-storage test:integration:s3
```

The package script already sets the gate:

```sh
pnpm --filter @toolbox/media-storage test:integration:s3
```

## Environment variables

| Variable                             | Default                 | Description                                 |
| ------------------------------------ | ----------------------- | ------------------------------------------- |
| `MEDIA_STORAGE_S3_INTEGRATION`       | unset                   | Must be `1` to run test.                    |
| `MEDIA_STORAGE_S3_ENDPOINT`          | `http://127.0.0.1:9000` | S3-compatible endpoint.                     |
| `MEDIA_STORAGE_S3_REGION`            | `us-east-1`             | S3 region.                                  |
| `MEDIA_STORAGE_S3_ACCESS_KEY_ID`     | `minioadmin`            | Access key.                                 |
| `MEDIA_STORAGE_S3_SECRET_ACCESS_KEY` | `minioadmin`            | Secret key.                                 |
| `MEDIA_STORAGE_S3_FORCE_PATH_STYLE`  | `true`                  | Path-style addressing.                      |
| `MEDIA_STORAGE_S3_BUCKET_PREFIX`     | `media-storage-it`      | Prefix for temporary test buckets.          |
| `MEDIA_STORAGE_S3_PUBLIC_URL`        | `{endpoint}/{bucket}`   | Public URL base. Supports `{bucket}` token. |

## Coverage

The integration test creates a temporary bucket, then validates:

- `putObject()`
- `headObject()` metadata
- `getObjectBuffer()`
- `getObjectStream()`
- `createPresignedGetUrl()` fetch
- POST upload target creation
- `copyObject()`
- public URL build/parse
- `deleteObjects()`
- not-found handling after delete

## Cleanup

The test deletes all objects and the temporary bucket in `afterAll()`. If a run is interrupted, remove buckets with the configured prefix manually from the MinIO console or CLI.
