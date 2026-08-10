---
trigger: always_on
glob: ["**/*.ts", "**/*.tsx", "app/**/*.ts", "src/**/*.ts"]
description: Pragmatic layered architecture — mandatory boundaries between controllers, services, repos, and domain types
priority: 5
tags: [architecture, pragmatic, layered, domain-driven, code-organization]
version: 2.0.0
---

# Pragmatic Layered Architecture (Rule)

Each feature/domain follows this structure:

```
/features/<domain>/
  <domain>.controllers.ts    // HTTP orchestration, cookies, redirects
  <domain>.services.ts       // workflow business rules & validation
  <domain>.repo.ts           // ORM access, persistence, transactions
  <domain>.domain.ts         // domain types, domain errors, domain invariants
  lib/
    <domain>.validations.ts  // input schemas
    <service>.client.ts      // feature-local external client wrapper (if needed)
  index.ts                   // public API: side-effect-free controller exports + types

/src/lib/
  <service>.client.ts   // shared external clients (used by 2+ features)
  <name>.core.ts        // pure utilities, importable anywhere
  <name>.server.ts      // framework-bound utilities, controllers-only
```

## Mandatory Boundaries

- **Controllers** call services only. **Never import `*.repo.ts`**, not even for a simple read.
- **Services** contain workflow rules (span multiple entities, need repo/client data). May call repos and external clients. **Never** import the ORM, cookies/headers, or `.server.ts` utility files.
- **Repos** are the only files that touch the ORM. No business logic, no thrown domain errors. Expose `withTransaction` for multi-step atomic writes — services compose repo calls inside it, never construct a transaction directly.
- **Domain types/errors/invariants** (`.domain.ts`): types, domain errors, and invariants a _single type enforces on itself_ (e.g. a `Money` value object rejecting negative amounts). No repo/client calls here — that's a workflow rule, belongs in services.
- **Validation schemas** live in `lib/<domain>.validations.ts`, not inline in controllers past a trivial check.
- **External clients**: shared → `src/lib/<service>.client.ts`; feature-specific wrapper → `features/<domain>/lib/<service>.client.ts`.
- **Utilities**: pure logic → `.core.ts` (importable anywhere); framework-bound (cookies/headers) → `.server.ts` (controllers-only, never imported by services).
- **Cross-feature calls** route only through another feature's `index.ts`, and only its **side-effect-free** controller exports (no cookies/redirects) — HTTP-bound handlers stay feature-private. `.services.ts` and `.repo.ts` are never exported across features.

## Trivial Guard Exception (Controllers)

Inline checks in controllers are OK only if **all** apply: data-existence check only (not business logic), no named policy, single-use, obvious without a function name. Otherwise extract to a service. Rule of thumb: if it needs a comment explaining _why_, extract it.

## Quick Reference

| Question                                          | Answer                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| Workflow business logic?                          | `*.services.ts`                                          |
| Domain invariant (single-type rule)?              | `*.domain.ts`                                            |
| Database access?                                  | `*.repo.ts`                                              |
| Can controllers call repos?                       | ❌ Never                                                 |
| Cookies/headers?                                  | `*.controllers.ts` or `.server.ts`                       |
| Can services call `.server.ts` or framework APIs? | ❌ No                                                    |
| Validation schema?                                | `lib/<domain>.validations.ts`                            |
| Shared third-party call?                          | `src/lib/<service>.client.ts`                            |
| Feature-specific client wrapper?                  | `features/<domain>/lib/<service>.client.ts`              |
| Multi-step atomic write?                          | `withTransaction` from repo, composed in service         |
| Cross-feature call?                               | Via `index.ts`, side-effect-free controller exports only |

---

**Full rationale, worked examples, testing guidance, and anti-patterns:** see `pragmatic-layered-architecture.md`.
