# 0003. Pragmatic Layered Architecture

Date: 2026-08-10

## Status

Accepted

## Context

The toolbox needs a lightweight, enforceable code-organization convention for TypeScript
backends (Next.js route handlers/Server Actions, Express, Nest, and similar), sitting between
two failure modes observed across prior projects:

- **No convention at all**: business rules, persistence, and HTTP concerns end up mixed in the
  same file. Fast at first, but validation logic and side effects drift into controllers,
  duplicate across routes, and become hard to test or move to a new framework.
- **Full Clean/Hexagonal Architecture adopted early**: use-case classes, dependency-inversion
  containers, and entity/aggregate ceremony imposed before the domain is well understood. This
  was tried directly on a project and found overwhelming relative to the size of the codebase —
  correct in theory, too much structure for the actual problem being solved.

What was missing was a middle option: strict enough to prevent the mixed-file failure mode,
light enough not to slow down day-to-day feature work, and adoptable at any project size rather
than positioned as an "MVP-only" shortcut to be replaced later.

The convention was drafted, then reviewed and hardened against six concrete gaps found in
practice: an unenforceable controller→repo exception, HTTP concerns leaking across feature
boundaries through shared controllers, an ambiguous external-client file location, a
services-may-only-import-pure-functions rule that no linter could check, an oversized always-on
rule file, and an absolute "no business rules outside services" statement that didn't leave room
for domain invariants (e.g. a value object rejecting its own invalid state).

## Decision

Adopt **Pragmatic Layered Architecture**: a four-file-per-feature convention —
controllers / services / repo / domain — plus two supporting file categories (validation
schemas, external clients) and a utility-file split (`.core.ts` / `.server.ts`), tracked in the
toolbox as a self-contained skill plus a discoverability pointer:

```txt
skills/layered-feature-scaffold/SKILL.md
skills/layered-feature-scaffold/references/pragmatic-layered-architecture-rule.md
skills/layered-feature-scaffold/references/pragmatic-layered-architecture.md
patterns/pragmatic-layered-architecture.md
```

The short rule is the source template for enforcement. Copy it into the appropriate rules
folder for the active workflow/tooling (Cursor, CLI agents, or another agent-specific rules
location) rather than treating the toolbox path itself as the active rule location.

Each feature/domain follows this structure:

```txt
/features/<domain>/
  <domain>.controllers.ts    # HTTP orchestration, cookies, redirects
  <domain>.services.ts       # workflow business rules & validation
  <domain>.repo.ts           # ORM access, persistence, transactions
  <domain>.domain.ts         # domain types, domain errors, domain invariants
  lib/
    <domain>.validations.ts  # input schemas
    <service>.client.ts      # feature-local external client wrapper (if needed)
  index.ts                   # public API: side-effect-free controller exports + types

/src/lib/
  <service>.client.ts   # shared external clients (used by 2+ features)
  <name>.core.ts        # pure utilities, importable anywhere
  <name>.server.ts      # framework-bound utilities, controllers-only
```

No `modules/` package is created for this decision; this is a code-organization convention,
not runtime code. The boundary discipline mirrors the same separation goals as the toolbox's
runtime modules, but applies them to file layout instead of injected interfaces.

## Layer boundaries

### Controllers (`*.controllers.ts`)

Orchestrate requests: parse input via validation schemas, call services, handle HTTP/session/
cookies/redirects. **Never import `*.repo.ts`**, not even for a simple read — every repo access
goes through a service, so the boundary is a single import rule rather than a judgment call
about which repo calls "count" as business decisions.

A controller file typically contains two kinds of exports: HTTP-bound handlers (call
`cookies()`/`redirect()`, meant to run inside a route) and side-effect-free orchestration
functions (call a service, return data, no HTTP side effects). Only the side-effect-free kind
may be re-exported from `index.ts` for cross-feature use — this keeps another feature's
in-process call from accidentally triggering a redirect or cookie write meant for a different
request.

### Services (`*.services.ts`)

Own workflow/application rules — logic that spans multiple entities or needs data from a repo
or external client. May call repos and external clients. Must never import the ORM, framework
APIs (cookies, headers), or `.server.ts` utility files.

### Repositories (`*.repo.ts`)

The only files that know about the ORM. Map DB rows to domain types, contain no business logic,
throw no domain errors. Expose the transaction boundary (`withTransaction`) so services can
compose multi-step atomic writes without touching the ORM directly.

### Domain types, errors, and invariants (`*.domain.ts`)

Domain types and domain errors live here as the feature's public data contract. This file also
holds **domain invariants** — validation a single type enforces on itself with no dependency on
other entities, repos, or clients (e.g. a `Money` value object rejecting a negative amount in
its constructor). The distinction that matters: invariants a type upholds alone stay in
`.domain.ts`; rules that need repo/client data or span multiple entities are workflow rules and
belong in `.services.ts`.

### Validation schemas (`lib/<domain>.validations.ts`)

Schema definitions live in their own file per feature, not inline in controllers past a trivial
single-field check. Internationalized apps use a `createXSchema(t)` factory; otherwise the
schema object is exported directly.

### External clients (`*.client.ts`)

Two tiers by scope: `src/lib/<service>.client.ts` for a client shared by two or more features
(the raw third-party SDK wrapper), and `features/<domain>/lib/<service>.client.ts` for a
feature-specific wrapper carrying that feature's own config/defaults over a shared client.
Clients are treated like repos — side effects a service is allowed to trigger, but not
framework/HTTP concerns.

### Utilities (`lib/`)

A concern needing both pure and framework-bound code (e.g. sessions: creating a session is
pure, setting a cookie isn't) is split into two files by suffix rather than mixed in one file:
`.core.ts` (framework-agnostic, importable from services or controllers) and `.server.ts`
(framework-bound, controllers-only). The split exists specifically so the services→server
boundary is a file-level import rule a linter can check, rather than a per-function convention
that only code review can catch.

### Cross-feature boundaries

Features do not import each other's `.services.ts` or `.repo.ts`. Cross-feature calls route
only through the target feature's `index.ts`, which exports side-effect-free controller
functions and public domain types — never controllers with HTTP side effects, services, or
repos.

## Enforcement

Most boundaries are mechanically enforceable with ESLint import-boundary rules, using
`no-restricted-imports`, path patterns, or a boundary plugin, since they resolve to file-suffix
or file-path checks:

- no `*.repo` import from `*.controllers.ts`
- no `.server.ts` import from `*.services.ts`
- no `features/*/*.services.ts` or `features/*/*.repo.ts` import from outside that feature

One boundary is not mechanically checkable: which controller exports are safe to re-export from
`index.ts` (side-effect-free) versus which must stay feature-private (HTTP-bound). This is a
naming/review convention, called out explicitly in the docs rather than left implicit, since an
unenforceable rule that looks enforceable is worse than one flagged as review-only.

## Consequences

Benefits:

- The controller→repo and services→server.ts boundaries are lintable, not just documented —
  closing the two gaps ("controllers may call repos for reads," "services may import pure
  functions from mixed files") that made the first draft's rules unenforceable in practice.
- Domain invariants have an explicit, correct home (`*.domain.ts`) instead of being forced into
  services or smuggled into controllers.
- The short always-on rule stays small enough to not dominate context on every file edit; the
  full rationale and edge cases are available on demand rather than always loaded.
- The scaffold skill generates a feature's files pre-wired to these boundaries (no controller
  ever imports a repo, `index.ts` only exports the side-effect-free variant), so following the
  convention is the path of least resistance rather than something to remember by hand.
- The convention is framework-agnostic and file-suffix-based (`.controllers.ts`, `.domain.ts`),
  so it reads consistently whether the underlying app is Next.js, Express, or Nest.

Tradeoffs:

- Routing every repo access through a service, even trivial reads, adds a small amount of
  boilerplate compared to letting controllers read directly.
- The `.core.ts`/`.server.ts` split means an extra file for any utility that mixes pure and
  framework-bound code, rather than one file.
- The HTTP-bound vs. exportable controller-function distinction still depends on review
  discipline, not tooling — the convention reduces but doesn't eliminate the risk of an HTTP
  side effect leaking across a feature boundary.
- Two client-file tiers (shared vs. feature-local) require a scope decision at scaffold time
  that a single-tier convention wouldn't need.

## Alternatives considered

- **Adopt Clean/Hexagonal Architecture wholesale** (use-case classes, dependency-inversion
  containers, entity/aggregate layers): rejected as the starting point that motivated this
  decision — too much ceremony for the size of problem this toolbox's projects actually have,
  and the stated goal is capturing reusable, adoptable-early patterns, not maximal
  architectural purity.
- **No file/layer convention, review-only discipline**: rejected because it was the failure
  mode observed in prior projects — validation and side effects drift into controllers and
  duplicate across routes without a structural boundary to catch it.
- **Route cross-feature calls through a dedicated use-case/application-service layer** instead
  of controller `index.ts` exports: rejected to avoid introducing a fifth file per feature;
  the side-effect-free/HTTP-bound split within `.controllers.ts` provides enough isolation for
  this convention without adding a new layer.
- **Single mixed utility file per concern** (pure and framework code together, e.g. one
  `sessions.ts`): rejected because "services may import only the pure exports" is a
  per-function rule no linter can check; the `.core.ts`/`.server.ts` split makes the same rule
  file-level and enforceable.
- **Keep the full 400+ line doc as the only always-on rule**: rejected due to context cost on
  every file edit in an agent workflow; split into a short always-on rule and a long
  on-demand reference instead.
