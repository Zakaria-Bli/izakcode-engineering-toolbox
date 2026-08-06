# Media Storage Adapter Guide

Status: production-ready adapter documentation.

Adapters isolate runtime/provider/framework dependencies from the framework-agnostic core. Import adapters only from their explicit subpaths so optional heavy peers stay out of core bundles.

## Adapter selection

| Need                                               | Adapter                 | Import                                              |
| -------------------------------------------------- | ----------------------- | --------------------------------------------------- |
| AWS S3, MinIO, SeaweedFS S3, R2-compatible APIs    | S3-compatible provider  | `@toolbox/media-storage/adapters/s3`                |
| Local development / single-node filesystem storage | Local provider          | `@toolbox/media-storage/adapters/local`             |
| Image metadata and variants                        | Sharp image processor   | `@toolbox/media-storage/adapters/sharp`             |
| Magic-byte MIME checks                             | Basic content inspector | `@toolbox/media-storage/adapters/content-inspector` |
| Express-like HTTP handlers                         | Express adapter         | `@toolbox/media-storage/adapters/express`           |
| Next/App Router HTTP handlers                      | Next adapter            | `@toolbox/media-storage/adapters/next`              |

## S3-compatible storage adapter

```ts
import { createS3StorageProvider } from "@toolbox/media-storage/adapters/s3"

const storage = createS3StorageProvider({
  bucket: "media",
  publicUrl: "https://cdn.example.com/media",
  region: "us-east-1",
  endpoint: "https://s3.example.com",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  uploadTargetMode: "post",
})
```

### Config

| Option                 | Required | Description                                                                                     |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `bucket`               | yes      | Bucket/container name.                                                                          |
| `publicUrl`            | yes      | Public/CDN base URL used by `getPublicUrl()` and persisted URLs.                                |
| `region`               | no       | Defaults to `us-east-1`.                                                                        |
| `endpoint`             | no       | S3-compatible endpoint for object operations and signing.                                       |
| `internalEndpoint`     | no       | Internal endpoint for server-side object operations when presigned URLs need public endpoint.   |
| `credentials`          | no       | Static credentials. SDK default chain can be used when omitted.                                 |
| `forcePathStyle`       | no       | Defaults to true when endpoint is set. Useful for MinIO/SeaweedFS.                              |
| `client`               | no       | Injected `S3Client` for object operations/tests.                                                |
| `presignClient`        | no       | Injected `S3Client` for presigning/tests.                                                       |
| `uploadOptions`        | no       | Signed PutObject options such as `ACL`, `CacheControl`, `ServerSideEncryption`, `StorageClass`. |
| `uploadHeaders`        | no       | Deprecated compatibility header bag. Prefer `uploadOptions`.                                    |
| `uploadTargetMode`     | no       | `"put"` default or `"post"` for presigned POST.                                                 |
| `presignedPostOptions` | no       | Extra POST `fields` and `conditions`.                                                           |

### Capabilities

The S3 adapter declares:

```txt
presignPut, uploadTarget, presignGet, publicUrl, copy, batchDelete, streamingRead
```

It declares `exactUploadSize: true` only when `uploadTargetMode: "post"`.

### PUT vs POST upload targets

`uploadTargetMode: "put"`:

- Returns a presigned PUT URL and signed headers.
- Compatible with many existing upload clients.
- Does not guarantee exact pre-storage upload-size rejection for every S3-compatible provider.
- Completion still revalidates object metadata before asset readiness.

`uploadTargetMode: "post"`:

- Returns a presigned POST URL, `fields`, and conditions.
- Includes exact `content-length-range` condition matching the expected size.
- Use with `policies.requireExactUploadSizeEnforcement: true` for strict production configurations.

### Provider notes

- **AWS S3**: prefer POST for strict size enforcement. Use bucket CORS rules allowing returned headers/methods.
- **MinIO**: use `endpoint`, `forcePathStyle: true`, and the integration harness under `integration/s3-compatible`.
- **SeaweedFS S3**: configure as S3-compatible; validate POST support before enabling strict enforcement.
- **Cloudflare R2**: use S3-compatible settings where supported by the R2 API; verify POST/copy/delete semantics in staging.

### Public URLs and signed downloads

- `getPublicUrl(key)` returns `publicUrl + encoded key`.
- `parsePublicUrl(url)` reverses URLs under the configured public base.
- `createPresignedGetUrl()` supports short-lived signed downloads and optional content-disposition overrides.

## Local filesystem adapter

```ts
import { createLocalStorageProvider } from "@toolbox/media-storage/adapters/local"

const storage = createLocalStorageProvider({
  rootDirectory: "/tmp/app-media",
  publicUrl: "http://localhost:3000/media",
  uploadUrl: "http://localhost:3000/api/media/local-put",
  signingSecret: process.env.MEDIA_LOCAL_SIGNING_SECRET!,
})
```

### Config

| Option          | Required | Description                                                |
| --------------- | -------- | ---------------------------------------------------------- |
| `rootDirectory` | yes      | Filesystem storage root. All keys resolve under this root. |
| `publicUrl`     | yes      | Public base URL for local objects.                         |
| `uploadUrl`     | yes      | App route that accepts signed local PUT uploads.           |
| `signingSecret` | yes      | HMAC signing secret for upload URL query parameters.       |
| `now`           | no       | Testable clock for signatures.                             |

### Security behavior

- Object keys are validated with traversal/backslash/absolute-path checks.
- Resolved paths must stay inside `rootDirectory`.
- Upload signatures cover key, expiry, content type, and content length.
- Verification uses constant-time comparison.
- `exactUploadSize: true` because the local PUT handler checks body length before writing.

### Next local PUT handler

```ts
import { createNextLocalPutObjectHandler } from "@toolbox/media-storage/adapters/next"

export const PUT = createNextLocalPutObjectHandler({
  storage,
  signingSecret: process.env.MEDIA_LOCAL_SIGNING_SECRET!,
  getActorId: async (request) => getActorFromRequest(request)?.id ?? null,
  authorize: async ({ actorId }) => {
    if (!actorId) throw new Error("unauthorized")
  },
})
```

For Express or other frameworks, implement an equivalent handler that calls `verifyLocalUploadSignature()` and then `storage.putObject()`.

### Local production caveat

Local storage is suitable for development, tests, and single-node/self-hosted deployments that understand filesystem persistence and sharing. Multi-replica deployments should use shared object storage or a shared volume with clear operational ownership.

## Sharp image processor adapter

```ts
import { createSharpImageProcessor } from "@toolbox/media-storage/adapters/sharp"

const imageProcessor = createSharpImageProcessor({
  normalizeMimeTypes: ["image/heic", "image/heif"],
  normalizeFormat: "jpeg",
  normalizeQuality: 95,
  failOn: "error",
})
```

### Config

| Option               | Default                    | Description                                                          |
| -------------------- | -------------------------- | -------------------------------------------------------------------- |
| `failOn`             | `"error"`                  | Sharp decode strictness: `none`, `truncated`, `error`, or `warning`. |
| `normalizeMimeTypes` | `image/heic`, `image/heif` | Source MIME types converted before metadata/variant processing.      |
| `normalizeFormat`    | `"jpeg"`                   | Format used for normalized source buffer.                            |
| `normalizeQuality`   | `95`                       | Quality for normalized source output.                                |

Core owns dimension validation so adapter behavior cannot drift from policy. Variants are generated from `policies.variants`; each variant controls width, optional height, fit, format, quality, and enlargement behavior.

## Basic content inspector adapter

```ts
import { createBasicContentInspector } from "@toolbox/media-storage/adapters/content-inspector"

const contentInspector = createBasicContentInspector({
  strictMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  allowedMimeAliases: {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["application/zip"],
  },
  rejectDetectedMismatch: true,
})
```

### Config

| Option                   | Default             | Description                                            |
| ------------------------ | ------------------- | ------------------------------------------------------ |
| `strictMimeTypes`        | common images + PDF | MIME types that must have recognizable magic bytes.    |
| `allowedMimeAliases`     | Office/ZIP aliases  | Expected MIME -> accepted detected MIME list.          |
| `rejectDetectedMismatch` | `true`              | Reject when detected known MIME differs from expected. |

Detected signatures include JPEG, PNG, GIF, WebP, AVIF, HEIC/HEIF, PDF, ZIP/Office, Windows executables, and ELF. Unknown bytes are accepted only for MIME types outside `strictMimeTypes`.

For antivirus, SVG sanitization, archive inspection, or PDF policy, provide a custom `ContentInspector` implementation.

## Express adapter

```ts
import {
  createExpressMediaAdapter,
  createExpressMediaErrorMiddleware,
} from "@toolbox/media-storage/adapters/express"

const handlers = createExpressMediaAdapter({
  media,
  getActorId: (_req, res) => res.locals.user?.id ?? null,
  authorize: async ({ action, actorId }) => {
    if (!actorId) throw new Error(`unauthorized:${action}`)
  },
  parseAssetId: (raw) => raw,
  successResponse: ({ data }) => ({ success: true, data, error: null }),
})

router.post("/uploads/init", handlers.createUploadIntent)
router.post("/uploads/:sessionId/complete", handlers.completeUpload)
router.post("/uploads/:sessionId/cancel", handlers.cancelUpload)
router.delete("/assets/:assetId", handlers.deleteAsset)
router.post("/assets/move", handlers.moveAssets)
router.post("/cleanup", handlers.cleanup)
router.use(createExpressMediaErrorMiddleware())
```

### Options

| Option                   | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `media`                  | Core `MediaStorageService`.                                   |
| `getActorId(req, res)`   | Resolve app actor from request/response.                      |
| `authorize(input)`       | Required unless action is explicitly allowed unauthenticated. |
| `allowUnauthenticated`   | Explicit action allow-list. Use sparingly.                    |
| `parseAssetId(raw)`      | Convert route strings to UUID/int/etc.                        |
| `successResponse(input)` | Preserve app response envelopes.                              |

### Request body shapes

Create upload intent:

```json
{
  "filename": "photo.jpg",
  "mimeType": "image/jpeg",
  "size": 12345,
  "kind": "image",
  "pathPrefix": "products/123",
  "metadata": {}
}
```

Complete upload:

```json
{ "checksum": "optional-sha256" }
```

Move assets:

```json
{ "assetIds": ["asset-1", "asset-2"], "toPrefix": "archive/2026" }
```

Cleanup:

```json
{ "limit": 100 }
```

Express handlers call `next(error)`; use the provided error middleware or map `MediaStorageError` in app middleware.

## Next/App Router adapter

```ts
import { createNextMediaRouteHandlers } from "@toolbox/media-storage/adapters/next"

const handlers = createNextMediaRouteHandlers({
  media,
  getActorId: async (request) => getActorFromRequest(request)?.id ?? null,
  authorize: async ({ action, actorId }) => {
    if (!actorId) throw new Error(`unauthorized:${action}`)
  },
  parseAssetId: (raw) => Number(raw),
})

export const POST = handlers.createUploadIntent
```

Map handlers into route files:

```txt
api/media/uploads/init/route.ts                  -> handlers.createUploadIntent
api/media/uploads/[sessionId]/complete/route.ts  -> handlers.completeUpload
api/media/uploads/[sessionId]/cancel/route.ts    -> handlers.cancelUpload
api/media/assets/[assetId]/route.ts              -> handlers.deleteAsset
api/media/assets/move/route.ts                   -> handlers.moveAssets
api/media/cleanup/route.ts                       -> handlers.cleanup
```

Options mirror the Express adapter with `Request`/`Response` primitives. Next handlers catch errors internally and return JSON. Override `errorResponse` to preserve an existing app envelope.

## Wrapping custom providers

When an application already has object-storage code, it is acceptable to wrap that provider instead of switching directly to toolbox S3/local adapters:

```ts
class AppStorageProvider implements ObjectStorageProvider {
  readonly name = "app-s3"
  readonly bucket = appProvider.bucket
  readonly capabilities = { uploadTarget: true, publicUrl: true, batchDelete: true }

  async createUploadTarget(input) {
    const target = await appProvider.createPresignedPutUrl(input)
    return { method: "PUT", ...target }
  }

  headObject(key) {
    return appProvider.headObject(key)
  }
  getObjectBuffer(key) {
    return appProvider.getObjectBuffer(key)
  }
  putObject(input) {
    return appProvider.putObject(input)
  }
  deleteObject(key) {
    return appProvider.deleteObject(key)
  }
  getPublicUrl(key) {
    return appProvider.getPublicUrl(key)
  }
}
```

Document limitations truthfully, especially exact upload-size enforcement and streaming support.

## Adapter validation

Run adapter tests from the module:

```sh
pnpm --filter @toolbox/media-storage test
```

Run S3-compatible integration when changing S3 config behavior:

```sh
docker compose -f modules/media-storage/integration/s3-compatible/docker-compose.yml up -d
pnpm --filter @toolbox/media-storage test:integration:s3
```
