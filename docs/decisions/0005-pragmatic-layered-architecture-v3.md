# 0005. Pragmatic Layered Architecture v3: Public API, Effects, Transactions

Date: 2026-10-19

## Status

Accepted — amends [0003](0003-pragmatic-layered-architecture.md)

## Context

Two independent reviews of the Pragmatic Layered Architecture (ADR 0003, rule v2.0.0) agreed on
the core layering — controller → service → repo, framework-free services, domain invariants
separate from workflow rules, ORM-to-domain mapping in repos — and found the same weak spots:

- **Cross-feature calls ran through the wrong layer.** `index.ts` re-exported "side-effect-free"
  controller functions, so feature A's service depended on feature B's controller. Importing one
  clean function still loads its whole module, including `next/headers` or `redirect` imports,
  into the caller. And "side-effect-free" was the wrong word: `createOrder()` writes data.
- **Business effects had two owners.** Both controllers and services could send emails or
  charge payments, so the same use case behaved differently when called over HTTP versus from
  another feature.
- **The transaction contract was incomplete.** `TxContext` was undefined (in practice an ORM type
  in service signatures), and nested transactions, cross-feature composition, rollback, and
  concurrency were not addressed. Repos could not throw domain errors, but nothing said what
  they did with a unique-constraint violation.
- **Internal contradictions.** Account-enumeration prevention appeared as an allowed "trivial
  guard" despite the exception excluding security policies; domain errors were declared public
  but `index.ts` could only export types; "duplication = extraction to services" sent repeated
  queries and schemas to the wrong layer.
- **Gaps and tooling.** No owner for error→HTTP mapping or for resolving the current user; no
  guidance on where Next.js pages, route handlers, and server actions sit; `.client.ts` collides
  with Remix/React Router (where such files are stripped from the server bundle) and with
  `"use client"`; enforcement was described as lintable but no configuration was shipped. The
  scaffold also exported `createOrderAction` from `index.ts` — the exact name the docs used as
  their example of a function that must never be exported.

## Decision

Revise the architecture to v3.0.0 (skill rule and full reference), keeping the four-file layout:

1. **`index.ts` is the transport-independent public API.** It re-exports selected use cases from
   `.services.ts` plus domain types, domain errors, and value objects. Controllers and repos are
   never exported. The routing layer (Next.js pages/route handlers/server actions, Express
   routers) imports `.controllers.ts` directly; nothing else does.
2. **One owner per effect.** Services own business effects (persistence via repos, third-party
   I/O via gateways) and authorization decisions; controllers own transport effects (cookies,
   headers, redirects, revalidation), resolve the current user and pass it in, and map domain
   errors to responses. External I/O is not covered by a DB transaction: run it after commit, or
   use a transactional outbox when it must happen with the write.
3. **Transaction and persistence-error contract.** A shared `src/lib/transaction.repo.ts` exposes
   `withTransaction(fn, outer?)` and an opaque `Tx` type; feature repos re-export it and accept
   `tx?: Tx`. Use cases join a caller's transaction instead of nesting. Repos translate driver
   errors into neutral errors in `src/lib/persistence-errors.core.ts`; services map them to domain
   errors. Database constraints are the guarantee for invariants under concurrency.
4. **Contradictions resolved.** Security policies, including enumeration prevention, are never
   trivial guards. Duplication is extracted by responsibility, and only when it is the same rule.
   Refactors preserve use-case contracts rather than promising controllers never change.
5. **Third-party wrappers are `.gateway.ts`.** The scaffold flag becomes `--gateway`, keeping
   `--client` as a deprecated alias.
6. **Enforcement is shipped and tested.** `assets/eslint-boundaries.template.mjs`
   (`eslint-plugin-boundaries` v7 with the TypeScript resolver) enforces the import rules,
   resolving aliases and checking re-exports and dynamic imports. `scripts/selftest.sh` checks it
   against the scaffold output and a set of deliberate violations.

## Consequences

Benefits:

- Calling another feature can no longer pull framework code into a service, and that rule —
  previously "review-only" in ADR 0003 — is now enforced by lint.
- A use case behaves the same for every caller, because its business effects live inside it.
- ORM types stay inside repos, including during transactions; uniqueness and other invariants
  hold under concurrency.
- The scaffold, the docs, and the lint config agree, and the self-test keeps them agreeing.

Tradeoffs:

- Existing v2 projects need a migration: `index.ts` re-exports services instead of controllers,
  and `*.client.ts` files are renamed to `*.gateway.ts`.
- Each project gets two small shared files (`transaction.repo.ts`, `persistence-errors.core.ts`).
- The ESLint config adds two devDependencies, and its project-layout block must be adjusted per
  repo.
- Deciding outbox versus after-commit for each effect is a per-use-case judgment that tooling
  cannot check.

## Alternatives considered

- **A separate facade or use-case file per feature** (e.g. `<domain>.api.ts`): rejected for the
  same reason ADR 0003 rejected a fifth file. `index.ts` re-exporting chosen service functions
  gives the same isolation with no new layer.
- **Keep controller exports and police them in review**: rejected. A module-level framework
  import is invisible at the call site, and review-only rules were the gap this revision closes.
- **Repos return result types instead of throwing neutral errors**: viable, but it forces every
  repo call site to unwrap results even when no error is expected. Neutral errors keep the happy
  path plain, and services only catch what they map.
- **`no-restricted-imports` patterns instead of a boundaries plugin**: rejected. Patterns match
  import strings, not resolved files, so aliases, relative paths, and barrels slip through, and
  they can't tell "same feature" from "another feature".
