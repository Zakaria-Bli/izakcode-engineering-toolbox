# iZakCode Engineering Toolbox

Reusable engineering assets extracted from real project work and hardened into modules,
patterns, workflow skills, templates, and shared tooling.

This repository is not an empty starter. It already contains production-grade architectural
building blocks for authentication, media storage, feature layering, internationalization,
code quality, CI, documentation, and copy-and-adapt reuse.

## Engineering value at a glance

| Asset                                                                                                                                                 | What exists now                                                                                                                                                                                                                                                | Problem it solves                                                                                                                                                                                         | Reuse / extension path                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@toolbox/media-storage`](modules/media-storage/README.md)                                                                                           | Production-ready framework-agnostic media module with direct uploads, lifecycle workflows, S3/local providers, Sharp/image adapters, Express/Next adapters, repository contract tests, examples, recipes, API docs, operations docs, and troubleshooting docs. | Prevents every app from rebuilding upload sessions, object metadata validation, image variant generation, cleanup, deletion, move rollback, storage-provider boundaries, and HTTP adapter error handling. | Use as a workspace package or copy-adapt module. Implement `MediaRepository`, choose a storage provider, inject app auth/usage policies, or add a new provider by implementing `ObjectStorageProvider`. |
| [`@toolbox/auth`](modules/auth/README.md)                                                                                                             | Internal auth blueprint with clean core/ports/services/adapters, email/password sign-in, registration orchestration, sessions, email verification, password reset, hashed tokens, permission helpers, Express/Next adapters, and Node token generation.        | Centralizes security-sensitive auth behavior while keeping framework, persistence, roles, permissions, mail, and password hashing app-owned.                                                              | Copy-adapt into a product, implement repositories/policies/ports, wire framework adapters, then promote to a package only after repeated validation.                                                    |
| [Pragmatic Layered Architecture](patterns/pragmatic-layered-architecture.md) + [`layered-feature-scaffold`](skills/layered-feature-scaffold/SKILL.md) | Enforceable TypeScript backend feature layout: controllers, services, repos, domain types, validations, external clients, and `.core.ts`/`.server.ts` utility split. Includes a scaffold script and long-form rationale.                                       | Optimizes for speed + evolvability: avoids mixed-file drift without imposing full Clean Architecture ceremony, keeping features fast to ship and safe to refactor later.                                  | Copy the short rule into an agent/tooling rules location, use the skill to scaffold features, and enforce import boundaries with ESLint.                                                                |
| [`nextjs-internationalization`](skills/nextjs-internationalization/README.md)                                                                         | Complete coding-agent workflow for migrating Next.js App Router apps to `next-intl`: locale-prefixed routes, RTL, localized metadata, navigation helpers, language switcher templates, CMS guidance, validation script, and eval prompts.                      | Makes i18n migration repeatable instead of rediscovering routing, middleware/proxy, message loading, RTL, metadata, and CMS boundaries per project.                                                       | Copy or reference the whole skill directory from an agent workflow, then apply the bundled templates and checklist inside a target Next.js app.                                                         |
| [`tooling/`](tooling) + root config                                                                                                                   | Shared ESLint, Prettier, TypeScript, and Vitest packages consumed by the workspace through root configs.                                                                                                                                                       | Keeps module and playground validation consistent without duplicating config in every package.                                                                                                            | Extend package-level configs only where a module needs stricter or framework-specific rules.                                                                                                            |
| [CI and quality gates](.github/workflows/ci.yml)                                                                                                      | GitHub Actions for lint, format, typecheck, tests, dependency audit, build, and CodeQL; Husky hooks for branch naming, lint-staged, commitlint, and pre-push validation.                                                                                       | Catches formatting, type, test, dependency, security-analysis, commit, and branch discipline issues before reusable assets drift.                                                                         | Reuse the workflow/action structure in projects that need the same quality baseline.                                                                                                                    |
| [`docs/decisions`](docs/decisions/README.md) and [`docs/principles`](docs/principles/README.md)                                                       | Accepted ADRs for auth, media storage, layered architecture, and Next.js i18n; environment-variable conventions.                                                                                                                                               | Preserves why the architecture exists, what was intentionally excluded, and where future changes should extend rather than bypass boundaries.                                                             | Add new ADRs for substantial module/pattern decisions and keep principles close to reusable code.                                                                                                       |

## Reusable modules

### `@toolbox/media-storage`

**Status:** production-ready reusable module.

Provides a complete media lifecycle engine for applications that need direct browser uploads,
object storage, image processing, and cleanup without coupling the workflow to one framework or
one database schema.

Core capabilities:

- create upload intents and direct upload targets
- complete or cancel uploads; read, list, move, delete, and cleanup assets
- validate MIME type, size, filenames, prefixes, object keys, metadata, checksums, and image data
- generate image metadata and variants through an injected `ImageProcessor`
- support S3-compatible object storage, local development storage, signed downloads, and public URLs
- coordinate object deletion through best-effort deletion or durable outbox retry workflows
- expose Express-like and Next/App-Router-like adapters that fail closed unless authorization is explicit
- provide a reusable repository contract test suite for application database adapters

Design value:

- The core imports only domain and port interfaces; Express, Next.js, Sharp, AWS SDK, auth, env,
  database schemas, and UI remain outside the core.
- Provider boundaries are explicit: storage providers own object operations only, repositories own
  persistence only, framework adapters own HTTP/auth/error mapping only.
- Operational concerns are documented in API, public contract, adapter, integration, operations,
  troubleshooting, recipe, and example docs.

Start with:

- [`modules/media-storage/README.md`](modules/media-storage/README.md)
- [`modules/media-storage/API-REFERENCE.md`](modules/media-storage/API-REFERENCE.md)
- [`modules/media-storage/PUBLIC-CONTRACTS.md`](modules/media-storage/PUBLIC-CONTRACTS.md)
- [`modules/media-storage/ADAPTERS.md`](modules/media-storage/ADAPTERS.md)
- [`modules/media-storage/OPERATIONS.md`](modules/media-storage/OPERATIONS.md)

### `@toolbox/auth`

**Status:** internal blueprint module.

Provides a framework-agnostic authentication core that product apps can adapt without inheriting
one app's database, framework, UI, roles, permissions, or mail infrastructure.

Core capabilities:

- email/password sign-in and registration orchestration
- password hashing through an injected `PasswordHasher`
- session creation, validation, refresh, invalidation, and absolute TTL caps
- email verification and password reset token workflows
- hashed token persistence contracts and one-time token consumption expectations
- role/permission helpers and app-owned policy hooks
- Express-like and Next-like adapters with secure cookie defaults and origin enforcement helpers
- Node crypto token generator adapter isolated to one runtime-specific file

Design value:

- Security-sensitive lifecycle behavior lives in one tested core rather than being recopied into
  every controller or Server Action.
- App-specific concerns are injected through repositories, policies, mailer, password hasher,
  token generator, clock, and logger ports.
- Recipes document production expectations such as transactional persistence, dummy password
  verification, reset invalidation, token replacement, and outbox-style email delivery.

Start with:

- [`modules/auth/README.md`](modules/auth/README.md)
- [`modules/auth/INTEGRATION.md`](modules/auth/INTEGRATION.md)
- [`modules/auth/recipes/README.md`](modules/auth/recipes/README.md)
- [`docs/decisions/0001-auth-module-architecture.md`](docs/decisions/0001-auth-module-architecture.md)

## Reusable patterns and workflow skills

### Pragmatic Layered Architecture

A lightweight backend feature architecture for TypeScript apps optimized for **speed +
evolvability**. It lets teams ship features with minimal ceremony today while preserving clean
seams for future refactors, extraction, testing, and framework movement.

```txt
/features/<domain>/
  <domain>.controllers.ts    # HTTP/session/cookies/redirect orchestration
  <domain>.services.ts       # workflow business rules and validation orchestration
  <domain>.repo.ts           # ORM and persistence access only
  <domain>.domain.ts         # domain types, errors, and local invariants
  lib/
    <domain>.validations.ts  # schemas
    <service>.client.ts      # feature-local external client wrapper, if needed
  index.ts                   # side-effect-free public exports + types
```

Reusable value:

- day-to-day work stays fast because every feature has a predictable small-file structure
- future refactors stay safer because controllers remain stable while service/repo/domain internals evolve
- controller-to-repo access is forbidden and mechanically enforceable
- services cannot import framework-bound `.server.ts` utilities
- cross-feature calls go through `index.ts`, not another feature's services/repos
- domain invariants have a clear home without mixing HTTP or persistence concerns
- `skills/layered-feature-scaffold/scripts/scaffold_feature.py` generates the structure with the
  correct imports already wired

### Next.js Internationalization Skill

A complete agent workflow for adding multilingual support to Next.js App Router applications with
`next-intl`.

Reusable value:

- central locale metadata, routing, request config, navigation helpers, utilities, and messages
- locale-prefixed frontend routes under `[locale]`
- `proxy.ts` / `middleware.ts` templates with exclusions for API/admin/static paths
- RTL/LTR document direction, styling, font, and language-switcher guidance
- localized metadata, canonical URL, data-fetching, cache-key, and CMS integration guidance
- `scripts/check_message_keys.py` for translation key parity validation

## Shared tooling and automation

The repository includes reusable infrastructure for keeping assets healthy:

- **Workspace model:** `pnpm-workspace.yaml` validates `modules/*`, `playgrounds/*`, and `tooling/*`.
- **Root validation:** `pnpm validate` runs lint, format check, typecheck, and tests.
- **Shared config packages:** `@toolbox/eslint-config`, `@toolbox/prettier-config`,
  `@toolbox/typescript-config`, and `@toolbox/vitest-config`.
- **Git hooks:** pre-commit branch-name validation and lint-staged fixes; commit-message
  Conventional Commit checks; pre-push full validation.
- **CI:** split lint/format, typecheck, test, dependency audit, build, and CodeQL jobs.
- **Repository hygiene:** PR template, issue templates, Dependabot, dependency overrides, security
  reporting, and environment-variable principles.

## Repository map

| Path                                            | Purpose                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| [`modules/`](modules/README.md)                 | Substantial reusable implementations and package candidates.            |
| [`patterns/`](patterns/README.md)               | Documented architecture and implementation approaches.                  |
| [`skills/`](skills/README.md)                   | Reusable coding-agent skills, references, assets, scripts, and evals.   |
| [`tooling/`](tooling)                           | Shared ESLint, Prettier, TypeScript, and Vitest configuration packages. |
| [`templates/`](templates/README.md)             | Project and feature starters meant to be copied into new work.          |
| [`snippets/`](snippets/README.md)               | Small reusable code fragments and examples.                             |
| [`playgrounds/`](playgrounds/README.md)         | Runnable integration and experimentation environments.                  |
| [`scripts/`](scripts/README.md)                 | Repository maintenance and automation scripts.                          |
| [`docs/decisions/`](docs/decisions/README.md)   | Architecture decision records.                                          |
| [`docs/principles/`](docs/principles/README.md) | Engineering principles and conventions.                                 |

## Reuse model

The default model is **copy and adapt**, not install and inherit.

That model is intentional:

1. Reusable behavior is extracted into modules, patterns, skills, and templates.
2. App-specific concerns stay at the edges through ports, policies, adapters, recipes, or local
   project code.
3. Assets collect validation history, tests, examples, limitations, and ADRs.
4. Only assets with stable boundaries and repeated use become package candidates.

Use this repository to:

- copy a proven module into a product and adapt its ports/adapters
- reference an architecture pattern before adding new feature code
- run an agent skill for repeatable implementation workflows
- borrow shared lint/test/format/build infrastructure
- add new ADRs when a reusable decision becomes important enough to preserve

## Development

Requirements are declared in [`package.json`](package.json): Node `>=24 <25` and pnpm `>=11 <12`.

```bash
pnpm install
pnpm validate
```

Useful commands:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm audit:dependencies
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branch naming, commit conventions, validation
commands, dependency rules, and pull request expectations.

## Security

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting and secret handling guidance.

## License

MIT. See [`LICENSE`](LICENSE).
