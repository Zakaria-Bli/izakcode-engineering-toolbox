---
trigger: always_on
glob: ["**/*.ts", "**/*.tsx", "app/**/*.ts", "src/**/*.ts"]
description: Pragmatic layered architecture — mandatory boundaries between controllers, services, repos, and domain types
priority: 5
tags: [architecture, pragmatic, layered, domain-driven, code-organization]
version: 3.0.0
---

# Pragmatic Layered Architecture (Rule)

One folder per domain (`<domain>` = the feature's singular name):

```
/features/<domain>/
  <domain>.controllers.ts    // transport adapter: input, current user, use cases, cookies/redirects, error→response
  <domain>.services.ts       // use cases: workflow rules, authorization, business effects
  <domain>.repo.ts           // ORM access, persistence-error translation, re-exports withTransaction
  <domain>.domain.ts         // types, domain errors, value objects, single-type invariants
  lib/
    <domain>.validations.ts  // input schemas
    <service>.gateway.ts     // feature-local third-party wrapper (if needed)
  index.ts                   // public API: use cases + types + errors + value objects

/src/lib/
  transaction.repo.ts          // withTransaction + opaque Tx
  persistence-errors.core.ts   // UniqueViolationError, ForeignKeyViolationError, ConcurrentUpdateError
  <service>.gateway.ts         // shared third-party wrappers (used by 2+ features)
  <name>.core.ts               // pure utilities, importable anywhere
  <name>.server.ts             // framework-bound utilities, controllers-only
```

## Mandatory Boundaries

- **Routing layer** (Next.js pages, route handlers, server actions; Express routers) imports `*.controllers.ts` only. With `"use server"`, every export is a public endpoint — authorize in each.
- **Controllers** call services only. **Never import `*.repo.ts`**, not even for a simple read. They resolve the current user and pass it to services explicitly, own transport effects (cookies, headers, redirects, revalidation), and map domain errors to responses.
- **Services** are use cases: workflow rules, authorization policies, and business effects (persistence via their repo, emails/payments/webhooks via gateways). **Never** import the ORM, framework/transport APIs, `.server.ts` files, or any controllers.
- **Repos** are the only files that touch the ORM. No business rules, no domain errors. Translate driver errors into neutral errors from `persistence-errors.core.ts`; services map those to domain errors. Raw ORM errors never escape.
- **Transactions**: services compose repo calls inside `withTransaction`; `Tx` is opaque outside repos. A use case that may join a caller's transaction takes `tx?: Tx` and passes it on — join, don't nest. External I/O is not rolled back: run it after commit, or use an outbox when it must happen with the write.
- **Concurrency**: DB constraints (unique, FK, check) guarantee invariants; a service-level pre-check alone races.
- **Domain** (`.domain.ts`): types, errors, value objects, and invariants a _single type enforces on itself_ (e.g. `Money` rejecting negative amounts). No repo/gateway calls — that's a workflow rule, it belongs in services.
- **Validation schemas** live in `lib/<domain>.validations.ts`, not inline in controllers past a trivial check.
- **Gateways** (`.gateway.ts`): third-party I/O only, no business logic. Shared → `src/lib/`; feature-specific config → `features/<domain>/lib/`.
- **Utilities**: pure logic → `.core.ts` (importable anywhere); framework-bound → `.server.ts` (controllers-only).
- **Cross-feature**: import only another feature's `index.ts`, which exports transport-independent use cases, domain types, domain errors, and value objects. Never its repo, never its controllers (they'd pull framework code into the caller).
- **Duplication**: extract by responsibility — queries → repo, schemas → validations, pure helpers → `.core.ts`/`.domain.ts`, workflow rules → services — and only when it's the same rule, not look-alike code.

## Trivial Guard Exception (Controllers)

Inline checks in controllers are OK only if **all** apply: data-existence check only (not business logic), no named policy, single-use, obvious without a function name. Otherwise extract to a service. Security policies (authorization, account-enumeration prevention) are never trivial. Rule of thumb: if it needs a comment explaining _why_, extract it.

## Quick Reference

| Question                                          | Answer                                               |
| ------------------------------------------------- | ---------------------------------------------------- |
| Workflow logic or authorization?                  | `*.services.ts`                                      |
| Domain invariant (single-type rule)?              | `*.domain.ts`                                        |
| Database access?                                  | `*.repo.ts`                                          |
| Can controllers call repos?                       | ❌ Never                                             |
| Cookies/headers/redirects?                        | `*.controllers.ts` or `.server.ts`                   |
| Emails/payments/webhooks?                         | Use case in `*.services.ts`, via a gateway           |
| Can services call `.server.ts` or framework APIs? | ❌ No                                                |
| Validation schema?                                | `lib/<domain>.validations.ts`                        |
| Shared third-party call?                          | `src/lib/<service>.gateway.ts`                       |
| Feature-specific gateway wrapper?                 | `features/<domain>/lib/<service>.gateway.ts`         |
| Multi-step atomic write?                          | `withTransaction` + opaque `Tx`, composed in service |
| Uniqueness under concurrency?                     | DB constraint, translated by the repo                |
| Cross-feature call?                               | Target's `index.ts` use cases only                   |
| Who imports controllers?                          | Only the routing layer                               |

---

**Enforcement:** the `layered-feature-scaffold` skill ships a tested ESLint config, `assets/eslint-boundaries.template.mjs`.
**Full rationale, worked examples, transactions, testing guidance, and anti-patterns:** see `pragmatic-layered-architecture.md`.
