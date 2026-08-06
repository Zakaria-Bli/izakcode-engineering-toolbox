# 0002. Media Storage Module Architecture

Date: 2026-07-31

## Status

Accepted

## Context

The toolbox needs a reusable media storage module derived from multiple existing media implementations:

- Hotel Reservation and Operations Platform media: Express-style controllers, admin-only upload permissions, S3-compatible storage, UUID asset/session IDs, image metadata validation, WebP variants, cleanup endpoint, and room-image usage checks.
- Real Estate Marketplace current storage: Next.js route handlers and Server Actions, S3-compatible direct uploads, database-generated integer asset IDs, image processing, move workflows, cleanup workflows, and React upload UI in application code.
- Real Estate Marketplace historical storage: local filesystem provider with signed upload routes and application-owned object cleanup.

These implementations prove a shared media lifecycle:

```txt
create upload intent -> direct browser upload -> complete upload -> ready asset
cancel / expire / fail -> terminal non-ready states + object cleanup
move / delete / cleanup -> storage mutations coordinated with persistence state
```

They also expose the same architectural problem: each application couples reusable media workflow logic to its framework, persistence model, environment variables, auth model, object-storage provider, image pipeline, route shape, and UI.

The common reusable parts are:

- upload-session state machine
- object metadata validation
- checksum and content validation
- image metadata and variant orchestration
- object key generation rules
- cancellation, deletion, move, and cleanup lifecycle ordering
- provider capability checks and compensation behavior
- framework-neutral error semantics

The application-specific parts are:

- route paths and response envelopes
- auth/session lookup and permission names
- database schema and migrations
- owner/actor ID shape
- asset kinds and metadata policy
- business reference checks before delete/cleanup
- UI components and upload hooks
- object-storage deployment settings

## Decision

Build `modules/media-storage` as a framework-agnostic media storage core with ports, adapters, examples, and recipes.

The core module must not import Express, Next.js, React, Drizzle, Sharp, AWS SDK, environment loaders, application auth modules, application database schemas, or application-specific domain tables.

Core media behavior depends on injected ports and policies:

- `MediaRepository` for asset, variant, and upload-session persistence
- `ObjectStorageProvider` for object-store operations
- `ImageProcessor` for image normalization, metadata, and variants
- `ContentInspector` for magic-byte checks or app-specific scanning
- `ObjectKeyStrategy` for object key generation
- `IdGenerator`, `Clock`, `Logger`, and `CompletionLimiter` runtime ports
- `actorPolicy` for ownership and permission checks
- `assetUsagePolicy` for app reference checks before delete/cleanup
- `MediaStoragePolicies` for MIME, size, metadata, prefix, lifecycle, variant, and URL rules

Implementation lives under `modules/media-storage/src`:

```txt
src/domain/   # domain DTOs, states, errors
src/ports/    # persistence, storage, image, content, runtime interfaces
src/core/     # upload/complete/cancel/read/delete/move/cleanup workflows
src/adapters/ # provider/framework/runtime adapters
src/testing/  # reusable repository contract suite
```

Framework integrations belong in `src/adapters`. Database schemas and application-specific mapping belong in application code or generic recipes. UI belongs in application code or separate templates, not in the core module.

## Core responsibilities

Core owns the reusable media lifecycle:

- upload intent validation
- pending asset and upload-session creation through repository port
- direct upload target creation through storage port
- upload completion state machine
- stored object metadata revalidation
- optional checksum verification
- optional content inspection
- image normalization, metadata extraction, and variant orchestration
- cancellation
- read/list/download URL orchestration
- delete with usage-policy protection
- move with copy-before-database-update ordering and rollback
- cleanup planning and execution
- partial-failure compensation

Core does not own:

- database schema or migrations
- application auth/session logic
- application permission names
- application reference tables
- HTTP route paths or response envelopes
- UI components
- cloud account provisioning or CDN configuration

## Port boundaries

### Repository port

`MediaRepository` owns persistence only. It must provide atomic/transactional behavior where workflows require it:

- `claimUploadForProcessing()` must be atomic.
- `completeUpload()` must persist asset readiness, variants, and session completion transactionally.
- `failUpload()`, `expireUpload()`, and `cancelUpload()` must be safe lifecycle transitions.
- `findCleanupCandidates()` must only return candidates safe for cleanup mutation.
- Optional `transaction()` lets core group move/cleanup state updates.
- Optional batch methods can reduce cleanup and move round-trips.

A reusable repository contract suite lives under `@toolbox/media-storage/testing` so applications can validate their adapters.

### Storage provider port

`ObjectStorageProvider` owns object operations only:

- direct upload targets
- signed get URLs
- head/read/write/copy/delete object operations
- public URL mapping
- optional streaming and multipart capabilities

Providers must not mutate repositories, authorize actors, process images, or run upload session state transitions.

### Image and content ports

`ImageProcessor` owns image-specific transformations behind an optional adapter boundary. The Sharp adapter lives under `adapters/sharp` so `sharp` remains an optional peer dependency.

`ContentInspector` owns magic-byte checks or custom scanning. A basic inspector is provided; stricter scanners can be injected by applications.

### Framework adapters

Framework adapters own request parsing, actor resolution, authorization hooks, response mapping, and error mapping. They call core service methods and must fail closed unless authorization is explicit.

## Provider strategy

S3-compatible storage is the primary production provider family. The S3 adapter supports:

- presigned PUT targets for compatibility
- presigned POST targets with exact `content-length-range` enforcement
- signed download URLs
- streaming reads
- copy operations
- batch delete
- public URL parsing/building

Local storage is supported for development, tests, and deployments that intentionally use a local/shared filesystem. Local upload URLs are HMAC-signed and checked by adapter/framework handlers.

Future providers should implement `ObjectStorageProvider` without core changes.

## Security decisions

- Validate declared MIME type and size before creating upload targets.
- Revalidate provider object metadata during completion.
- Provide exact pre-storage upload-size enforcement when provider capabilities support it.
- Provide content inspection hooks for hostile uploads.
- Validate and normalize filenames, path prefixes, metadata, and object keys.
- Reject traversal and unsafe object keys.
- Keep cleanup/delete/move behind explicit authorization.
- Hide internal errors from framework adapter responses unless `MediaStorageError.expose` is true.
- Treat signed upload URLs as credentials and keep TTLs short.

## Lifecycle decisions

- Completion claims uploads before reading/processing objects.
- Repeated completion of an already-completed session is idempotent.
- Retryable provider failures can release processing claims when the repository supports `releaseUploadClaim()`.
- Variant objects are not persisted unless writes succeed.
- Move copies targets before repository updates and rolls back copied targets on failure.
- Cleanup deletes objects before marking repository records cleaned/deleted.
- Deletion defaults to simple best-effort object removal after repository state changes.
- Durable delete retry is available through an optional object deletion outbox and worker helper.

## Consequences

Benefits:

- Upload and cleanup lifecycle rules are centralized and testable.
- Applications can reuse core workflows while keeping their own database schema, auth, route paths, and response envelopes.
- Existing applications can migrate incrementally through adapters while preserving client contracts.
- New object storage providers can be added by implementing one port.
- Heavy dependencies stay isolated behind adapter subpaths.
- Repository contract tests make application persistence adapters safer.

Tradeoffs:

- Applications must implement a repository adapter rather than importing a ready-made schema.
- Strict upload-size enforcement depends on provider capability and configuration.
- Image processing and content inspection still require bounded buffers today.
- Multipart/resumable workflows are represented as experimental provider capabilities but are not full core workflows yet.

## Alternatives considered

- Copy one existing media feature directly into the toolbox: rejected because it would preserve framework, database, auth, environment, and domain coupling.
- Put upload session state transitions inside storage providers: rejected because providers should own object operations only.
- Ship separate media modules per framework: rejected because the shared lifecycle would drift.
- Ship a mandatory database schema: rejected because applications use different ID strategies, schemas, and ownership models.
- Include React upload UI in core: rejected because UI belongs in applications or separate templates.
