---
trigger: manual
description: Full reference for the Pragmatic Layered Architecture — rationale, examples, effects, transactions, persistence errors, cross-feature boundaries, framework placement, enforcement, testing guidance, anti-patterns. Consult on demand when creating new layers, reviewing for violations, or resolving an edge case not covered by the short always-on rule.
priority: 5
tags: [architecture, pragmatic, layered, domain-driven, code-organization]
version: 3.0.0
---

# Pragmatic Layered Architecture (Full Reference)

> This is the full reference doc. For the short always-on rule that stays loaded during every
> edit, see `pragmatic-layered-architecture-rule.md`. This doc has the rationale, worked
> examples, effects, transactions, cross-feature boundaries, testing guidance, and anti-patterns —
> read it when creating a new layer, reviewing for violations, or hitting an edge case.

## Contents

- [Goal](#goal)
- [File Structure](#file-structure)
- [Architectural Boundaries (Mandatory)](#architectural-boundaries-mandatory) — controllers,
  services, repos, domain, validations, gateways, utilities
- [Effects: Who Owns What](#effects-who-owns-what)
- [Transactions](#transactions)
- [Persistence Errors](#persistence-errors)
- [Error Mapping at the Edge](#error-mapping-at-the-edge)
- [Cross-Feature Boundaries](#cross-feature-boundaries)
- [Framework Placement](#framework-placement)
- [Enforcement](#enforcement)
- [Core Rules (Strict)](#core-rules-strict) and the trivial-guard exception
- [Extracting Duplication](#extracting-duplication)
- [Evolution Rules](#evolution-rules-future-ready), [Orchestration Pattern](#orchestration-pattern),
  [Decision Principle](#decision-principle)
- [Testing Guidance](#testing-guidance), [Anti-Patterns](#anti-patterns-reject--refactor),
  [When to Refactor](#when-to-refactor), [Quick Reference](#quick-reference)

## Goal

Ship fast **without blocking future refactors** by enforcing a minimal but strict separation between:

- Transport (HTTP, server actions, sessions)
- Use cases and business rules
- ORM / persistence

This rule optimizes for **speed + evolvability**, at any project size, and is framework-agnostic
(Next.js, Express, Nest, etc.).

---

## File Structure

One feature folder holds one domain; `<domain>` is the feature's singular name (`order`, not
`orders`), and every file in the folder uses it as its prefix.

```
/features/<domain>/
  <domain>.controllers.ts    // transport adapter: input, current user, use-case calls, cookies/redirects, error→response
  <domain>.services.ts       // use cases: workflow rules, authorization, business effects
  <domain>.repo.ts           // ORM access, persistence-error translation, re-exports withTransaction
  <domain>.domain.ts         // domain types, domain errors, value objects & single-type invariants
  lib/
    <domain>.validations.ts  // input schemas
    <service>.gateway.ts     // feature-local third-party wrapper (if needed)
  index.ts                   // public API: use cases + types + errors + value objects

/src/lib/
  transaction.repo.ts          // withTransaction + opaque Tx (shared transaction boundary)
  persistence-errors.core.ts   // neutral persistence errors (UniqueViolationError, ...)
  <service>.gateway.ts         // shared third-party wrappers (used by 2+ features)
  <name>.core.ts               // pure utilities, importable anywhere
  <name>.server.ts             // framework-bound utilities, controllers-only
```

When suggesting new files or refactors, prefer creating missing layers over adding logic to the
wrong file.

---

## Architectural Boundaries (Mandatory)

### 1. Controllers (`<domain>.controllers.ts`)

Controllers are the **transport adapter**. They:

- Parse input via schemas from `lib/<domain>.validations.ts`
- Resolve the current user from the session/cookies and pass it to use cases **explicitly**
  (services can't read cookies, so identity always arrives as an argument)
- Call services (never repos — see rule below)
- Own transport effects: cookies, headers, redirects, cache revalidation, status codes
- Map domain errors to transport responses (see **Error Mapping at the Edge**)

Controllers are imported only by the routing layer (see **Framework Placement**). Other features
never import them — they use the target feature's `index.ts` instead.

Controllers **must not**:

- Contain business rules or authorization policies
- Contain validation logic beyond input shape
- Trigger business effects directly (emails, payments, webhooks) — those belong to the use case
- Import `*.repo.ts`, for any reason, including simple pass-through reads

**Rule:** There is no case where a controller calls a repo directly — even a trivial "fetch by
id and return it" goes through a service. This removes the ambiguous "repo calls are OK unless
it's a business decision" judgment call and makes the boundary lintable.

**Allowed**

```ts
// auth.controllers.ts
const dto = createSignInSchema(t).parse(formData)
const user = await validateUserCanSignIn(dto.email, dto.password) // ✅ use case
const session = await startUserSession(user.id) // ✅ use case (persists the session)
await setSessionCookie(session.token) // ✅ transport effect, from sessions.server.ts
```

**Forbidden**

```ts
// ❌ business logic in controller
if (!user.emailVerified) throw new Error()

// ❌ any repo call from a controller, even a simple read
import { findUserByEmail } from "./auth.repo"
const user = await findUserByEmail(email) // ❌ move to a service, e.g. getUserByEmail()
```

### 2. Services (`<domain>.services.ts`)

Services hold the feature's **use cases**. They:

- Contain **workflow/application rules** — logic that spans multiple entities, needs repo or
  gateway data, or represents a use case (see the domain-invariant split below)
- Make **authorization decisions** using the actor the controller passed in
- Own **business effects**: persistence via repos, third-party I/O via gateways (see **Effects**)
- May call their own feature's repo, gateways, `.core.ts` utilities, and other features'
  `index.ts` exports
- Use plain types from `<domain>.domain.ts`

**Domain invariants vs. workflow rules:** not all business logic belongs in services. A rule that
a _single type must always uphold on its own_ — independent of other entities or external data —
is a domain invariant and belongs in `<domain>.domain.ts`, colocated with the type it protects
(e.g. a `Money` value object rejecting negative amounts, or an `Email` type validating its own
format). A rule that needs data from a repo/gateway, or spans multiple entities, is a workflow
rule and belongs in `.services.ts`.

Services **must not**:

- Import the ORM directly
- Import framework/transport APIs (Next.js `headers`/`cookies`/`redirect`, Express `req`/`res`)
  or any `.server.ts` utility
- Import any controllers — their own or another feature's
- Deep-import another feature's internals (only its `index.ts`)

**Allowed**

```ts
// Use case: repo read for a business decision
export async function validateUserCanSignIn(email: string, password: string): Promise<AuthUser> {
  const user = await findUserByEmail(email) // ✅ own repo
  if (!user) throw new UnauthorizedError()
  // ... business logic
}

// Use case: persistence + business effect
export async function registerUser(input: RegisterInput): Promise<AuthUser> {
  const user = await insertUser(input) // ✅ own repo
  await sendWelcomeEmail(user.email) // ✅ gateway — a business effect, owned here
  return user
}

// Authorization policy, actor passed in by the controller
export function assertCanVerifyEmail(actorId: IntID | null, tokenUserId: IntID): void {
  if (actorId !== null && tokenUserId !== actorId) {
    throw new UnauthorizedError()
  }
}
```

**Forbidden**

```ts
import { db } from "@/db" // ❌ ORM import
import { cookies } from "next/headers" // ❌ framework API
import { setSessionCookie } from "./lib/sessions.server" // ❌ framework-bound utility
import { getOrderAction } from "@/features/order/order.controllers" // ❌ controllers
import { findOrderById } from "@/features/order/order.repo" // ❌ another feature's internals
```

### 3. Repository Layer (`<domain>.repo.ts`)

Repositories:

- Are the only place that knows about the ORM
- Map DB rows → domain types
- Translate ORM/driver errors into neutral persistence errors (see **Persistence Errors**)
- Re-export the shared transaction boundary and accept an optional `tx` (see **Transactions**)
- Contain no business logic

Repositories **must not**:

- Apply business rules
- Throw domain errors
- Let raw ORM/driver errors escape
- Be imported by anything other than their own feature's services (and other repos)

**Allowed**

```ts
export async function findUserByEmail(email: string, tx?: Tx): Promise<AuthUser | null>
```

**Forbidden**

```ts
if (!row.emailVerified) throw new Error() // ❌ business rule in a repo
```

Prefer consistent return types: `Promise<T | null>` for single lookups, `Promise<T[]>` for lists.

### 4. Domain Types, Errors & Value Objects (`<domain>.domain.ts`)

Domain types, domain errors, and value objects are defined here, separate from ORM types. All
three are part of the feature's public contract, so `index.ts` may re-export any of them —
including runtime classes (errors other features catch with `instanceof`, value objects they
construct).

This file also holds **domain invariants** — validation a single type enforces on itself, with no
dependency on other entities, repos, or gateways.

ORM types **must never** leak outside repositories.

**Allowed**

```ts
export interface AuthUser {
  id: number
  email: string
}

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}

// ✅ domain invariant — a value object enforcing its own constraint,
// no external data needed, so it stays here rather than in a service
export class Money {
  private constructor(private readonly cents: number) {}
  static create(cents: number): Money {
    if (cents < 0) throw new InvalidMoneyError()
    return new Money(cents)
  }
}
```

**Forbidden**

```ts
export type AuthUser = typeof users.$inferSelect // ❌ ORM type as domain type

// ❌ workflow rule masquerading as a domain invariant — needs repo data,
// belongs in a service, not here
export async function assertEmailNotTaken(email: string) {
  const existing = await findUserByEmail(email) // ❌ domain.ts must not call repos
  if (existing) throw new EmailTakenError()
}
```

### 5. Validation Schemas (`lib/<domain>.validations.ts`)

Schema definitions live in their own file per feature:

- Use `createXSchema(t)` factory functions for internationalized apps.
- Use the schema object directly (no factory) when the app isn't internationalized.
- Controllers import and call schemas from here; schemas never live inline in a controller once
  they exceed a single trivial field check.

```ts
// lib/auth.validations.ts
export const createSignInSchema = (t: TFunction) =>
  z.object({
    email: z.string().email(t("errors.invalidEmail")),
    password: z.string().min(8, t("errors.tooShort")),
  })
```

Schemas check **input shape**. Rules that need data (is this email taken? does this coupon
exist?) are workflow rules and belong in services.

### 6. Gateways (`*.gateway.ts`)

Third-party I/O (email, payment, webhooks, external APIs) lives in gateway files, in one of two
places depending on scope:

```
/src/lib/<service>.gateway.ts                    // shared — used by 2+ features
/features/<domain>/lib/<service>.gateway.ts      // feature-specific wrapper/config
```

- **Shared gateway** (`src/lib/`): the raw third-party SDK wrapper — e.g.
  `src/lib/stripe.gateway.ts` wraps the Stripe SDK once, used by billing, subscriptions,
  refunds, etc.
- **Feature-local gateway** (`features/<domain>/lib/`): a thin wrapper over a shared gateway with
  feature-specific config/defaults. Only create this tier if the feature needs its own config;
  otherwise import the shared gateway directly.

Gateways:

- Contain no business logic — just the third-party call and response mapping
- Are called by services, which own the business effect and decide how failures are handled
- Don't touch transport concerns (cookies, headers, redirects)

**Why `.gateway.ts` and not `.client.ts`:** in Remix/React Router, `*.client.ts` modules are
stripped from the server bundle — a `mailer.client.ts` would silently vanish where it's needed —
and in React/Next.js "client" already means browser code (`"use client"`). Gateway is the
established name for an object that wraps access to an external system.

```ts
// src/lib/mailer.gateway.ts — shared
export async function sendEmail(to: string, template: string): Promise<void> { ... }

// features/auth/lib/mailer.gateway.ts — feature-local wrapper, if auth needs its own defaults
import { sendEmail } from "@/lib/mailer.gateway"
export async function sendWelcomeEmail(to: string): Promise<void> {
  return sendEmail(to, "welcome-template")
}
```

### 7. Utility Functions (`lib/`)

A concern that needs both pure logic and framework-specific code (e.g. sessions: creating a
session token is pure, setting a cookie isn't) is split into **two files by suffix**, not mixed in
one file. "Services may only import the pure half of a mixed file" isn't mechanically checkable —
a file-level split is.

- **`.core.ts`** (e.g. `sessions.core.ts`, `password.core.ts`): framework-agnostic, importable
  from services, controllers, and domain files
- **`.server.ts`** (e.g. `sessions.server.ts`, `http-errors.server.ts`): framework-bound
  (cookies, headers, responses), controllers-only
- **`.gateway.ts`**: third-party I/O (section 6), called by services

```ts
// lib/sessions.core.ts — pure, safe to import in services
export function createSessionToken(userId: IntID): SessionToken { ... }
```

```ts
// lib/sessions.server.ts — framework-bound, controllers only
import { cookies } from "next/headers"
export async function setSessionCookie(token: string): Promise<void> { ... }
```

---

## Effects: Who Owns What

Every effect has exactly one owner, so the same use case behaves the same whether it's called
from a route or from another feature.

| Effect                                                     | Owner                               |
| ---------------------------------------------------------- | ----------------------------------- |
| Persisting data                                            | Service, via its repo               |
| Business I/O: emails, payments, webhooks, external APIs    | Service, via gateways               |
| Transport: cookies, headers, redirects, cache revalidation | Controller (or a `.server.ts` util) |
| Mapping errors to status codes / responses                 | Controller                          |

If a controller sends the welcome email, a second caller of `registerUser` (an admin import, a
signup from another feature) silently skips it. Keeping business effects in the use case is what
makes `index.ts` exports safe to reuse.

### Failures and retries

A database transaction does not cover external I/O: if the email is sent and the transaction then
rolls back, the email still went out; if the transaction commits and the email call fails, the
data is saved without it. Decide per effect, in the service:

- **Must happen with the write** (payment confirmation, audit event, outbound webhook a partner
  depends on): use a **transactional outbox** or equivalent — write an outbox row in the same
  transaction, and let a worker deliver it with retries and an idempotency key.
- **Best-effort** (welcome email, analytics): run it **after** the transaction commits; log or
  queue a retry on failure and don't fail the use case.
- **Must happen before the write** (charge a card, then record it): call the gateway first with an
  idempotency key, then persist; make the retry path safe to re-run.

Don't assume the transaction wrapper makes a mixed DB + network workflow atomic.

---

## Transactions

When a business operation must persist across multiple repo calls atomically, services compose
those calls inside `withTransaction`. The transaction boundary lives in the repo layer; services
never construct a transaction from the ORM.

### The contract

```ts
// src/lib/transaction.repo.ts — the shared boundary (a .repo.ts file: it touches the ORM)
declare const txBrand: unique symbol
export type Tx = { readonly [txBrand]: true } // opaque outside repos

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, outer?: Tx): Promise<T> {
  if (outer) return fn(outer) // join the caller's transaction instead of nesting
  return db.transaction((ormTx) => fn(ormTx as unknown as Tx))
}

export function executor(tx?: Tx) {
  return (tx as unknown as typeof db | undefined) ?? db // repo-only
}
```

```ts
// features/user/user.repo.ts
export { type Tx, withTransaction } from "@/lib/transaction.repo"

export async function insertUser(data: NewUser, tx?: Tx): Promise<User> {
  const [row] = await executor(tx).insert(users).values(data).returning()
  return mapRowToUser(row)
}
```

```ts
// features/user/user.services.ts
export async function registerUser(input: RegisterInput, tx?: Tx) {
  return withTransaction(async (activeTx) => {
    const user = await insertUser(input, activeTx) // ✅ ORM hidden behind the repo
    const session = await insertSession({ userId: user.id }, activeTx) // ✅ same transaction
    return { user, session }
  }, tx)
}
```

- **`Tx` is opaque.** Services pass it along but can't call ORM methods on it, so no ORM type
  appears in a service signature. Only repos turn it back into an executor.
- **Join, don't nest.** A use case that might run inside a caller's transaction takes `tx?: Tx`
  and passes it to `withTransaction` as `outer`. The outermost caller owns commit and rollback.
  If you genuinely need a savepoint, add a dedicated repo-level helper rather than nesting
  `withTransaction` calls.
- **Rollback is by throwing.** Any error thrown inside `fn` rolls back the whole transaction.
  Don't catch-and-continue inside it unless you rethrow; map errors to domain errors either
  inside (then rethrow) or after the transaction.
- **Cross-feature composition.** Feature A's use case can include feature B's use case in its
  transaction by calling B's `index.ts` export with its `tx`. B stays in charge of its own
  writes; A never touches B's repo.
- **Keep external I/O out.** See **Failures and retries** above.

### Concurrency and constraints

Under concurrency, the **database constraint is the guarantee**; a service-level check is only a
friendlier error message. "Check that the email is free, then insert" races: two requests can
both pass the check.

- Declare unique, foreign-key, and check constraints for invariants the data must never violate,
  and let them reject bad writes.
- Translate the resulting driver error in the repo (see below) and map it to a domain error in
  the service (`UniqueViolationError` on `users_email_key` → `EmailTakenError`).
- For read-modify-write flows, use row locks (`SELECT ... FOR UPDATE`) or optimistic versioning
  (a `version` column checked in the `UPDATE`); surface a lost race as `ConcurrentUpdateError`,
  which the caller may retry.

---

## Persistence Errors

Repos never throw domain errors, but they also never let raw ORM errors escape. The contract:

1. **Repos translate** driver/ORM errors they understand into neutral errors from
   `src/lib/persistence-errors.core.ts`: `UniqueViolationError`, `ForeignKeyViolationError`,
   `ConcurrentUpdateError` (each carrying the constraint name where available). Anything else is
   rethrown unchanged — it's an infrastructure failure.
2. **Services map** the persistence errors they expect to domain errors with business meaning.
3. **Controllers map** domain errors to responses; anything unmapped becomes a 500.

```ts
// user.repo.ts
export async function insertUser(data: NewUser, tx?: Tx): Promise<User> {
  try {
    const [row] = await executor(tx).insert(users).values(data).returning()
    return mapRowToUser(row)
  } catch (error) {
    if (isUniqueViolation(error)) throw new UniqueViolationError(error.constraint)
    throw error
  }
}

// user.services.ts
try {
  return await insertUser(input, tx)
} catch (error) {
  if (error instanceof UniqueViolationError && error.constraint === "users_email_key") {
    throw new EmailTakenError()
  }
  throw error
}
```

Persistence errors are neutral (not owned by any feature), so they live in a shared `.core.ts`
file that repos and services can both import.

---

## Error Mapping at the Edge

Services throw domain errors; controllers decide what they mean for the transport. Keep the
mapping in one place — a shared `src/lib/http-errors.server.ts` — so every route answers the same
way:

```ts
// src/lib/http-errors.server.ts
export function toHttpError(error: unknown): { status: number; code: string } {
  if (error instanceof NotFoundError) return { status: 404, code: "not_found" }
  if (error instanceof ForbiddenError) return { status: 403, code: "forbidden" }
  if (error instanceof ValidationError) return { status: 422, code: "invalid_input" }
  return { status: 500, code: "internal_error" } // never leak unknown error messages
}
```

---

## Cross-Feature Boundaries

Features do not reach into each other's internals. The only importable surface of a feature is
its `index.ts`, which is its **transport-independent public API**:

- Selected **use cases** from `.services.ts`
- Public **domain types**, **domain errors**, and **value objects** from `.domain.ts`

**Transport-independent, not side-effect-free.** A use case like `createOrder()` writes to the
database and may send an email — those are its business effects, and they're the reason another
feature calls it. What it must not do is depend on a transport: no cookies, headers, redirects,
or request objects, and no framework imports anywhere in its module graph.

That last part is why **controllers are never re-exported**. Importing one "safe" function from
`order.controllers.ts` still loads the whole module — including its `next/headers` or
`next/navigation` imports — into the calling feature. Exporting use cases from the services
module keeps the framework out of the caller's import graph entirely. The routing layer imports
`<domain>.controllers.ts` directly, by path.

`.repo.ts` is never exported either: callers would bypass the use cases (and their authorization
and invariants).

```ts
// features/order/index.ts
export type { Order, OrderStatus } from "./order.domain" // ✅ public types
export { OrderNotFoundError } from "./order.domain" // ✅ runtime error, catchable by callers
export { cancelOrder, createOrder } from "./order.services" // ✅ transport-independent use cases
// ❌ never export order.repo.ts — callers would bypass the use cases
// ❌ never export order.controllers.ts — it drags framework code into the caller
```

```ts
// features/billing/billing.services.ts
import { createOrder, OrderNotFoundError } from "@/features/order" // ✅ via index.ts only
```

**Cycles.** If feature A's use cases need B and B's need A, the boundary is wrong: extract the
shared concept into its own feature, or move the orchestration that needs both into a third
feature that depends on each.

**Enforcement:** all of this is lintable — deep imports into another feature, `index.ts`
re-exporting controllers or repos, and services importing controllers are all blocked by the
shipped ESLint config (see **Enforcement**).

---

## Framework Placement

The **routing layer** is the code the framework calls: it's the only place that imports
`<domain>.controllers.ts`, and it stays thin.

**Next.js (App Router)**

- `app/**/page.tsx`, `layout.tsx` (Server Components), `route.ts` handlers, and server actions
  call controller functions — not services or repos.
- `redirect()`, `notFound()`, `revalidatePath()`, `cookies()`, `headers()` are transport effects:
  controllers or `.server.ts` utilities only.
- **`"use server"` makes every export a public endpoint.** If a controllers file carries the
  directive, each exported function can be invoked directly from the client with arbitrary
  arguments — authenticate and authorize inside every one of them, and keep non-action helpers
  out of that file.
- `middleware.ts` / `proxy.ts` is transport: it may use `.server.ts` and `.core.ts` utilities
  but doesn't call services.

**Express (and similar)**

- Routers and route registration call controllers; session/auth middleware resolves the current
  user, and controllers pass it to use cases.
- `req`/`res` never cross into services.

**Nest**

- The `@Controller` class lives in `<domain>.controllers.ts` and plays the controller role.
- Services may be `@Injectable` classes, but must not inject `REQUEST`, `Response`, or other
  transport objects; identity arrives as an argument, as everywhere else.

---

## Enforcement

The boundaries are file-suffix and folder based so a linter can check them. The skill ships a
tested ESLint flat config: `assets/eslint-boundaries.template.mjs` (built on
`eslint-plugin-boundaries` with the TypeScript import resolver). It enforces:

- no import of a feature's internals from outside it — only its `index.ts` (the routing layer
  may also import `*.controllers.ts`)
- `index.ts` never re-exports controllers, repos, or `.server.ts` files
- controllers never import repos
- services never import controllers, `.server.ts` files, or transport modules (`next/headers`,
  `next/navigation`, `next/server`, `next/cache`, `express`)
- repos never import services, controllers, gateways, or a feature's `index.ts`
- domain and `.core.ts` files never import I/O layers or transport modules
- gateways never import controllers, services, or repos
- only `*.repo.ts` files import ORM/driver packages

Why it's sound rather than a filename grep: imports are **resolved** through tsconfig paths, so
an alias and a relative path to the same file are the same edge; `export ... from` re-exports and
dynamic `import()` are checked as well as plain imports, so a barrel can't launder a forbidden
module; and since every edge is checked, a forbidden module can't arrive **transitively** — each
hop on the way would itself be a violation.

What linting can't check: whether a use case really is transport-independent beyond its imports
(e.g. it takes a `Request` object as a parameter), whether effects are in the right owner, and
whether the outbox decision was right. Those stay review items.

The skill's `scripts/selftest.sh` re-runs the config against the scaffold output plus a set of
deliberate violations; run it after changing either.

---

## Core Rules (Strict)

- ❌ No controller → repo calls, ever (not even simple reads — go through a service)
- ❌ No ORM imports outside `*.repo.ts` files
- ❌ No workflow rules outside `*.services.ts` files (domain invariants may live in `*.domain.ts`;
  see the trivial-guard exception below)
- ❌ No framework/transport imports in services (cookies, headers, redirects), including
  `.server.ts` utility files
- ❌ No business effects (emails, payments, webhooks) triggered from controllers
- ❌ No cross-feature imports of anything except the target feature's `index.ts`
- ❌ No controllers or repos exported from `index.ts`
- ❌ No raw ORM errors escaping repos; no domain errors thrown from repos
- ✅ Creation and validation are centralized in use cases
- ✅ Services may call their repo for data needed for business decisions
- ✅ Services own business effects; controllers own transport effects
- ✅ Database constraints guarantee invariants under concurrency
- ✅ Cross-feature calls go through the target feature's `index.ts` use cases

### Exception: Trivial Guards in Controllers

Simple guards may remain inline in controllers when **all** of these conditions are met:

1. **Data check only** — Verifies existence/null, not business logic
2. **No policy name** — Doesn't represent a named rule or security policy
3. **Single use** — No reuse potential across controllers
4. **Obvious intent** — Meaning is clear without a function name

**Allowed inline:**

```ts
// ✅ Simple existence check on input — no business logic
if (!verificationToken) {
  throw new UnauthorizedError("errors.noVerificationToken")
}

// ✅ Mapping an absent result to the transport's "not found"
const order = await findOrderForActor(actor, orderId) // use case returns Order | null
if (!order) notFound()
```

**Must extract to a service:**

```ts
// ❌ Security policy - has a name ("user can only verify own email")
if (currentUser && token.userId !== currentUser.id) {
  throw new UnauthorizedError()
}
// ✅ Extract as:
assertCanVerifyEmail(currentUser?.id ?? null, token.userId)

// ❌ Security policy - account-enumeration prevention
const user = await getUserByEmail(email)
if (!user) return { success: true } // same answer whether or not the account exists
// ✅ The use case enforces it for every caller; the controller maps one outcome:
await requestPasswordReset(email) // returns normally whether or not the user exists

// ❌ Business rule - checks domain state
if (user.bannedAt) throw new ForbiddenError()
// ✅ Should be part of validateUserCanSignIn()

// ❌ Reusable validation
if (new Date(token.expiresAt) < new Date()) throw new Error()
// ✅ Should be in verifyUserEmail()
```

**Rule of thumb:** If you need a comment to explain _why_, extract it. The function name becomes
the documentation. Security policies — authorization, enumeration prevention, rate-limit
decisions — are never trivial guards, however short.

---

## Extracting Duplication

Extract by **responsibility**, not by repetition alone. Repeated code goes to the layer that owns
that kind of logic:

| Repeated...                                     | Extract to                    |
| ----------------------------------------------- | ----------------------------- |
| Queries / row mapping                           | `*.repo.ts`                   |
| Input schemas                                   | `lib/<domain>.validations.ts` |
| Pure helpers, single-type invariants            | `*.core.ts` / `*.domain.ts`   |
| Workflow rules, authorization policies          | `*.services.ts`               |
| Transport plumbing (error mapping, cookie code) | `*.server.ts`                 |
| Third-party call setup                          | `*.gateway.ts`                |

Extract when the duplicates are **the same rule** — they must change together. Two snippets that
merely look alike today but serve different rules are cheaper left apart than coupled; a wrong
abstraction costs more than a little duplication. Security and invariant logic is the exception:
one copy only, always.

---

## Evolution Rules (Future-Ready)

- Domain logic may later be refactored into entities/classes
- Repositories may later implement interfaces/abstract classes
- Refactors behind the service layer **preserve the use-case contracts** controllers and other
  features depend on — function names, inputs, outputs, and the domain errors they throw — so
  callers rarely need to change. When a contract must change, change it deliberately and update
  its callers in the same change.

Prefer adding seams (extension points) rather than abstractions upfront.

---

## Orchestration Pattern

Controllers should follow this pattern:

1. Parse/validate input shape (schema from `lib/<domain>.validations.ts`)
2. Resolve the current user from the session
3. Call the use case, passing the input and the actor
4. Apply transport effects (cookies, redirects, revalidation)
5. Map the result or domain error to a response

Services should:

- Receive data and the actor as arguments
- Apply business rules and authorization
- Read and persist through their repo, inside `withTransaction` when atomicity matters
- Trigger business effects through gateways, with an explicit failure policy
- Return results or throw domain errors
- Never handle transport concerns

**Example flow:**

```ts
// Controller orchestrates
const user = await validateUserCanSignIn(email, password) // use case decides
const session = await startUserSession(user.id) // use case persists the session
await setSessionCookie(session.token) // controller applies the transport effect
```

## Decision Principle

- **Logic spans multiple entities or needs repo/gateway data?** → `*.services.ts`
- **Authorization or other security policy?** → `*.services.ts`
- **Logic is a single type's own invariant (no external data needed)?** → `*.domain.ts`
- **Logic touches the database?** → `*.repo.ts` (controllers never call this directly)
- **Driver error to interpret?** → translate in `*.repo.ts`, give it meaning in `*.services.ts`
- **Logic touches HTTP/session/cookies?** → `.controllers.ts` or a `.server.ts` utility
- **Type, domain error, or value object?** → `*.domain.ts`
- **Input validation schema?** → `lib/<domain>.validations.ts`
- **Email, payment, webhook, external API?** → a `*.gateway.ts`, called from a service
- **Pure utility function?** → `<name>.core.ts` (importable anywhere)
- **Framework utility (cookies/headers)?** → `<name>.server.ts` (controllers-only)
- **Multi-step atomic persistence?** → `withTransaction` from the repo, composed in the service
- **Needs to be called from another feature?** → a use case exported from `index.ts`

---

## Testing Guidance

- **Services, unit**: test business rules with repos and gateways mocked/stubbed — e.g. "banned
  user cannot sign in", "expired token rejected". Fast, no DB or network.
- **Services, integration**: run use cases against a real (test) database for behavior mocks
  can't show — transaction rollback, constraint violations mapped to domain errors, concurrent
  requests racing (two signups with the same email, two updates to the same row). Mocked unit
  tests alone are not enough for these.
- **Repos**: integration-test against a real (test) database or in-memory adapter. Verify row
  mapping, persistence-error translation, and `tx` handling, not business rules.
- **Controllers**: thin orchestration — test at the integration/e2e level (does the flow work end
  to end, do errors map to the right responses), not unit level. Don't re-test business rules.
- **Gateways**: mock in service tests; contract-test separately against the real third-party API
  (sandbox/staging) if critical (e.g. payments).

**Rule of thumb:** a business rule is proven by a service unit test; atomicity and concurrency
are proven by a service integration test against a real database.

---

## Anti-Patterns (Reject & Refactor)

- "Just for now" business logic in controllers
- Any controller importing `*.repo.ts` directly, even for a trivial read
- Controllers sending emails or charging payments (business effects outside the use case)
- Exporting ORM models (e.g., `typeof users.$inferSelect`) as domain types
- ORM transaction types in service signatures instead of the opaque `Tx`
- Raw ORM/driver errors escaping a repo, or repos throwing domain errors
- Service-level "check then insert" as the only uniqueness guarantee
- Utility files mixing pure and framework code instead of a `.core.ts`/`.server.ts` split
- Skipping domain structure because "we'll refactor later"
- Validation logic scattered across multiple files instead of `lib/<domain>.validations.ts`
- Services importing framework utilities (cookies, headers) or `.server.ts` files
- Services handling transport effects (cookies, redirects)
- Services constructing ORM transactions directly instead of using `withTransaction`
- Cross-feature imports of anything other than the target feature's `index.ts`
- Controllers or repos re-exported from `index.ts`
- A domain invariant (single-type, no external data) pulled into a service instead of living in
  `.domain.ts`
- A workflow rule (needs repo/gateway data) left in `.domain.ts` instead of moved to a service
- Inline **business rules or security policies** in controllers — trivial guards are OK (see
  Exceptions)
- Assuming a DB transaction makes external I/O atomic
- Extracting look-alike code that serves different rules
- Using exceptions as an excuse to avoid extraction — when in doubt, extract

---

## When to Refactor

When you see:

- Same workflow rule called from multiple controllers → extract to `*.services.ts`
- Database queries duplicated → consolidate in `*.repo.ts`
- Same input schema in several places → consolidate in `lib/<domain>.validations.ts`
- Business rules mixed with HTTP handling → move to `*.services.ts`
- An email/payment call in a controller → move it into the use case
- ORM imports in non-repo files → move to `*.repo.ts`
- Cookie/session handling in services → move to controllers
- Inline business logic in controllers → extract to services (unless trivial guard)
- Inconsistent return types in repos → standardize (prefer `Promise<T | null>`)
- Comment explaining "why" for an inline check → extract and let the function name document it
- A feature deep-importing another feature's files → route through its `index.ts`
- `index.ts` re-exporting controllers → export the underlying use cases instead

Suggest: "This could live in `[domain].services.ts` so every caller gets the same behavior."

---

## Summary

**Simple now, structured always, strict later.**

This architecture enables shipping fast — from MVPs to mature codebases — while keeping things
evolvable. Each layer has one job, each effect has one owner, and each feature exposes one public
API. Refactoring internals doesn't ripple into callers. Naming (`.controllers.ts`, `.domain.ts`,
`.gateway.ts`) reads consistently across Next.js, Express, Nest, and similar frameworks.

---

## Quick Reference

| Question                                                | Answer                                                   |
| ------------------------------------------------------- | -------------------------------------------------------- |
| Where does workflow business logic go?                  | `*.services.ts`                                          |
| Where do authorization/security policies go?            | `*.services.ts`                                          |
| Where do domain invariants (single-type rules) go?      | `*.domain.ts`                                            |
| Where does database access go?                          | `*.repo.ts`                                              |
| Where do cookies/headers/redirects go?                  | `*.controllers.ts` or a `.server.ts` utility             |
| Who sends emails / charges payments?                    | The use case in `*.services.ts`, via a gateway           |
| Where do types, domain errors & value objects go?       | `*.domain.ts`                                            |
| Where do validation schemas go?                         | `lib/<domain>.validations.ts`                            |
| Where do shared third-party calls go?                   | `src/lib/<service>.gateway.ts`                           |
| Where do feature-specific gateway wrappers go?          | `features/<domain>/lib/<service>.gateway.ts`             |
| Can controllers call repos?                             | ❌ No — never, not even for a simple read                |
| Can services call repos?                                | ✅ Their own feature's, for data needed for decisions    |
| Can services call framework APIs or `.server.ts` files? | ❌ No                                                    |
| How does a service know the current user?               | The controller passes it in as an argument               |
| Who maps domain errors to HTTP responses?               | Controllers, via a shared `.server.ts` mapper            |
| Can controllers have inline checks?                     | ✅ Only trivial guards — never security policies         |
| Can utility files mix pure + framework code?            | ❌ No — split into `.core.ts` and `.server.ts`           |
| How are multi-step transactions handled?                | `withTransaction` + opaque `Tx`, composed in the service |
| What guarantees uniqueness under concurrency?           | A DB constraint, translated by the repo                  |
| Can features import each other's internals?             | ❌ No — only the target's `index.ts`                     |
| What does `index.ts` export?                            | Use cases, domain types, domain errors, value objects    |
| Who imports `*.controllers.ts`?                         | Only the routing layer (pages, route handlers, routers)  |
