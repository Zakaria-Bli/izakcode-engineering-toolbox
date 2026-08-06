# Media Storage Examples

These examples show integration shapes. They are intentionally small and app-agnostic; bring your own `MediaRepository`, auth, environment loader, and framework router.

## Files

- [`local-dev.ts`](./local-dev.ts) — local filesystem provider for development.
- [`s3-compatible.ts`](./s3-compatible.ts) — S3/MinIO/SeaweedFS/R2-style provider with exact-size POST targets.
- [`custom-provider.ts`](./custom-provider.ts) — minimal in-memory `ObjectStorageProvider` shape.
- [`express-routes.ts`](./express-routes.ts) — Express-like handler wiring with fail-closed auth.
- [`next-route-handlers.ts`](./next-route-handlers.ts) — Next/App Router style handlers.
- [`delete-outbox-worker.ts`](./delete-outbox-worker.ts) — durable object deletion worker loop.

## Validate the package before using examples

```sh
pnpm --filter @toolbox/media-storage build
pnpm --filter @toolbox/media-storage pack:dry-run
```
