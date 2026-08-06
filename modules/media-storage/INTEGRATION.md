# Media Storage Integration

Status: production-ready integration guidance.

This document tracks integration guidance for `@toolbox/media-storage`.

## Integration model

Applications provide:

- `MediaRepository` implementation for their database/schema
- `ObjectStorageProvider` implementation or toolbox adapter
- `ImageProcessor` implementation, usually Sharp adapter
- policies for MIME types, sizes, path prefixes, cleanup, ownership, and usage checks
- framework adapter or custom HTTP handlers

Use `createBasicContentInspector()` for common magic-byte validation, or provide a stricter `ContentInspector` for antivirus scanning, PDF/SVG policy, archives, or other app-specific content checks.

Framework adapters fail closed for media actions unless an `authorize` hook is supplied or the action is explicitly listed in `allowUnauthenticated`. For routes protected by external middleware, still pass an `authorize` hook when possible so media-specific permissions remain visible at the adapter boundary.

Core remains framework-agnostic. The package exports built `dist` JavaScript and `.d.ts` files; run `pnpm --filter @toolbox/media-storage build` before local package-consumer tests that import package subpaths directly.

For high-volume cleanup or bulk moves, repository adapters may implement optional `markAssetsDeleted()` and `updateAssetObjectKeysBatch()` methods. Core detects these methods and falls back to `markAssetDeleted()` / `updateAssetObjectKeys()` when absent.

For durable object deletion, implement `ObjectDeletionOutbox` in the same database layer and run `processObjectDeletionOutbox()` from a worker. Repository methods can enqueue delete requests in the same transaction as media row changes. See [`recipes/delete-outbox.md`](./recipes/delete-outbox.md).

## S3-compatible storage

Use the S3-compatible adapter for AWS S3, SeaweedFS, MinIO, R2-compatible S3 APIs, or similar stores.

SeaweedFS should be configured as S3-compatible storage rather than treated as a core provider.

The S3 adapter supports two upload target modes:

- `uploadTargetMode: "put"` signs `ContentType` and includes `ContentLength` in the presigned PUT command, but exact pre-storage size enforcement varies by S3-compatible provider.
- `uploadTargetMode: "post"` returns a presigned POST target with exact `content-length-range` conditions.

Use `uploadTargetMode: "post"` with policy `requireExactUploadSizeEnforcement: true` for production configurations that must reject oversized uploads before object creation.

## Local storage

Use the local adapter for local development or self-hosted filesystem storage. Framework-specific signed PUT/download route helpers belong in the adapter layer.

## React upload UI

React hooks/components are intentionally separate from this module. Use an application component or future toolbox template that talks to app upload endpoints.

See examples in [`examples/`](./examples/), especially local dev, S3-compatible, Express, Next, custom provider, and delete outbox worker wiring.

Start with the production checklist, then follow the app-specific recipe. Use [`API-REFERENCE.md`](./API-REFERENCE.md) for method/policy details, [`ADAPTERS.md`](./ADAPTERS.md) for adapter options, [`OPERATIONS.md`](./OPERATIONS.md) for rollout/runbooks, and [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) for error diagnosis.

See:

- [`recipes/production-integration-checklist.md`](./recipes/production-integration-checklist.md)
- [`recipes/react-upload-ui.md`](./recipes/react-upload-ui.md)
- [`recipes/repositories.md`](./recipes/repositories.md)
- [`recipes/delete-outbox.md`](./recipes/delete-outbox.md)
