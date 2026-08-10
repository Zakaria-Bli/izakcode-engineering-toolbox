---
trigger: manual
description: Full reference for the Pragmatic Layered Architecture — rationale, examples, transactions, cross-feature boundaries, testing guidance, anti-patterns. Consult on demand when creating new layers, reviewing for violations, or resolving an edge case not covered by the short always-on rule.
priority: 5
tags: [architecture, pragmatic, layered, domain-driven, code-organization]
version: 2.0.0
---

# Pragmatic Layered Architecture (Full Reference)

> This is the full reference doc. For the short always-on rule that stays loaded during every
> edit, see `pragmatic-layered-architecture-rule.md`. This doc has the rationale, worked
> examples, transactions, cross-feature boundaries, testing guidance, and anti-patterns —
> read it when creating a new layer, reviewing for violations, or hitting an edge case.

## Goal

Ship fast **without blocking future refactors** by enforcing a minimal but strict separation between:

- Controllers
- Business logic
- ORM / persistence

This rule optimizes for **speed + evolvability**, at any project size, and is framework-agnostic (Next.js, Express, Nest, etc.).

---

## Architectural Boundaries (Mandatory)

### 1. Controllers (`<domain>.controllers.ts`)

Controllers:

- Orchestrate requests
- Call services (never repos — see rule below)
- Handle HTTP/session/cookies/redirects
- Parse input via schemas from `lib/<domain>.validations.ts`

Controllers **must not**:

- Contain business rules
- Contain validation logic beyond input shape
- Import `*.repo.ts`, for any reason, including simple pass-through reads

**Rule:** There is no case where a controller calls a repo directly — even a trivial "fetch by id and return it" goes through a service. This removes the ambiguous "repo calls are OK unless it's a business decision" judgment call and makes the boundary lintable: `no-restricted-imports` can block any `*.repo` import from `*.controllers.ts` files, full stop.

A controller file typically contains two kinds of exports — see **HTTP-Bound vs. Exportable Functions** below for the distinction that matters when another feature needs to call in.

**Allowed**

```ts
// auth.controllers.ts
const dto = createSignInSchema(t).parse(formData)
const user = await validateUserCanSignIn(dto.email, dto.password) // ✅ service call
const session = await startUserSession(user.id) // ✅ service call
await setSessionCookie(session.token) // ✅ cookie handling (side effect)
```

**Forbidden**

```ts
// ❌ business logic in controller
if (!user.emailVerified) throw new Error()

// ❌ any repo call from a controller, even a simple read
import { findUserByEmail } from "./user.repo"
const user = await findUserByEmail(email) // ❌ move to a service, e.g. getUserByEmail()
```

### 2. Domain Logic (`<domain>.services.ts`)

Domain logic:

- Contains **workflow/application rules** — logic that spans multiple entities, needs repo or client data, or represents a use case (see the domain-invariant split below)
- **May call repository functions for data access** (needed for business decisions)
- **May call external-service clients** (`lib/<client>.client.ts`) for third-party I/O
- Uses plain interfaces/types from `<domain>.domain.ts`

**Domain invariants vs. workflow rules:** not all business logic belongs in services. A rule that a _single type must always uphold on its own_ — independent of other entities or external data — is a domain invariant and belongs in `<domain>.domain.ts`, colocated with the type it protects (e.g. a `Money` value object rejecting negative amounts in its constructor, or an `Email` type validating its own format). A rule that needs data from a repo/client, or spans multiple entities, is a workflow rule and belongs in `.services.ts`. See section 4 below for the domain-invariant example.

Domain logic **must not**:

- Import ORM directly
- Import framework APIs (Next.js, cookies, headers, etc.)
- Have side effects beyond persistence via repos or I/O via clients
- Handle HTTP concerns (cookies, redirects, headers)

**Allowed**

```ts
// Services can call repos for data needed for business logic
export async function validateUserCanSignIn(email: string, password: string): Promise<UserProps> {
  const user = await findUserByEmail(email) // ✅ repo call for business decision
  if (!user) throw new UnauthorizedError()
  // ... business logic
}

// Services can call external clients for third-party I/O
export async function registerUser(input: RegisterInput) {
  const user = await createUser(input) // ✅ repo call
  await sendWelcomeEmail(user.email) // ✅ client call
  return user
}

// Pure business rules
export function assertCanVerifyEmail(currentUserId: IntID | null, tokenUserId: IntID): void {
  if (currentUserId !== null && tokenUserId !== currentUserId) {
    throw new UnauthorizedError()
  }
}
```

**Forbidden**

```ts
import { db } from "@/db" // ❌ ORM import
import { cookies } from "next/headers" // ❌ Framework API
import { setSessionCookie } from "./lib/sessions" // ❌ Framework utility (cookies)
```

### 3. Repository Layer (`<domain>.repo.ts`)

Repositories:

- Are the only place that knows about the ORM
- Map DB rows → domain types
- Contain no business logic
- Expose the transaction boundary (see **Transactions** below)

Repositories **must not**:

- Apply business rules
- Throw domain errors
- Be used directly by UI or by other features

**Allowed**

```ts
export async function findUserByEmail(email): Promise<AuthUser | null>
```

**Forbidden**

```ts
if (!row.emailVerified) throw new Error() // ❌
```

### 4. Domain Types & Errors (`<domain>.domain.ts`)

Domain types and domain errors are defined here, separate from ORM types. Both are part of the domain's public contract, so they share one file.

This file may also hold **domain invariants** — validation a single type enforces on itself, with no dependency on other entities, repos, or clients. Keep these colocated with the type they protect rather than pulling them out into a service.

ORM types **must never** leak outside repositories.

**Allowed**

```ts
interface AuthUser {
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
    if (cents < 0) throw new Error("Money cannot be negative")
    return new Money(cents)
  }
}
```

**Forbidden**

```ts
export type AuthUser = typeof users.$inferSelect // ❌

// ❌ workflow rule masquerading as a domain invariant — needs repo data,
// belongs in a service, not here
export function assertEmailNotTaken(email: string) {
  const existing = await findUserByEmail(email) // ❌ domain.ts must not call repos
  if (existing) throw new Error()
}
```

### 5. Validation Schemas (`lib/<domain>.validations.ts`)

Schema definitions live in their own file per feature:

```
/features/<domain>/lib/<domain>.validations.ts
```

- Use `createXSchema(t)` factory functions for internationalized apps.
- Use the schema object directly (no factory) when the app isn't internationalized.
- Controllers import and call schemas from here; schemas never live inline in a controller once they exceed a single trivial field check.

**Allowed**

```ts
// lib/auth.validations.ts
export const createSignInSchema = (t: TFunction) =>
  z.object({
    email: z.string().email(t("errors.invalidEmail")),
    password: z.string().min(8, t("errors.tooShort")),
  })
```

### 6. External Service Clients (`*.client.ts`)

Third-party I/O (email, payment, webhooks, external APIs) lives in dedicated client files, in one of two places depending on scope:

```
/src/lib/<service>.client.ts                    // shared — used by 2+ features
/features/<domain>/lib/<service>.client.ts      // feature-specific wrapper/config
```

- **Shared client** (`src/lib/`): the raw third-party SDK wrapper — e.g. `src/lib/stripe.client.ts` wraps the Stripe SDK once, used by billing, subscriptions, refunds, etc.
- **Feature-local client** (`features/<domain>/lib/`): a thin wrapper over a shared client with feature-specific config/defaults — e.g. `features/billing/lib/stripe.client.ts` calls `src/lib/stripe.client.ts` with billing-specific webhook handling. Only create this tier if the feature needs its own config; otherwise import the shared client directly.

Clients:

- Are treated like repos: side effects services are allowed to trigger, but not framework/HTTP concerns
- Contain no business logic — just the third-party call and response mapping
- Are imported by services or controllers, wherever the I/O is needed

**Allowed**

```ts
// src/lib/mailer.client.ts — shared
export async function sendEmail(to: string, template: string): Promise<void> { ... }

// features/auth/lib/mailer.client.ts — feature-local wrapper, if auth needs its own defaults
import { sendEmail } from "@/lib/mailer.client"
export async function sendWelcomeEmail(to: string): Promise<void> {
  return sendEmail(to, "welcome-template")
}
```

### 7. Utility Functions (`lib/`)

A concern that needs both pure logic and framework-specific code (e.g. sessions: creating a session is pure, setting a cookie isn't) is split into **two files by suffix**, not mixed in one file. "Services may only import the pure half of a mixed file" isn't mechanically checkable — a file-level split is, so this is the lintable version of that idea.

**Categories:**

- **`.core.ts`** (e.g. `sessions.core.ts`, `password.core.ts`, `token.core.ts`): Framework-agnostic, importable from services or controllers
- **`.server.ts`** (e.g. `sessions.server.ts`): Framework-bound (cookies, headers), controllers-only
- **`.client.ts`** (e.g. `mailer.client.ts`): Third-party I/O (see section 6), importable from services or controllers

**Import Rules:**

- Services may import `.core.ts` and `.client.ts` files
- Controllers may import `.core.ts`, `.server.ts`, and `.client.ts` files
- Services must never import a `.server.ts` file

**Example split:**

```ts
// lib/sessions.core.ts — pure, safe to import in services
export function createSession(userId: IntID): Session { ... }
```

```ts
// lib/sessions.server.ts — framework-bound, controllers only
import { cookies } from "next/headers"
export async function setSessionCookie(token: string): Promise<void> { ... }
```

**Allowed in services:**

```ts
import { createSession } from "./lib/sessions.core" // ✅ .core.ts
import { sendWelcomeEmail } from "./lib/mailer.client" // ✅ .client.ts
```

**Forbidden in services:**

```ts
import { setSessionCookie } from "./lib/sessions.server" // ❌ .server.ts import
```

**ESLint boundary:** block `*.server` imports from `*.services.ts`, same mechanism as the controller→repo rule — file-suffix-based, not function-based, so it's actually enforceable by tooling rather than code review alone.

---

## Transactions

When a business operation must persist across multiple repo calls atomically, the transaction boundary is exposed by the repo layer, never constructed directly by services.

```ts
// user.repo.ts
export async function withTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
  return db.transaction(fn) // ✅ only the repo touches the ORM
}

export async function createUser(data: NewUser, tx?: TxContext) { ... }
export async function createSession(data: NewSession, tx?: TxContext) { ... }
```

```ts
// user.services.ts
export async function registerUser(input: RegisterInput) {
  return withTransaction(async (tx) => {
    const user = await createUser(input, tx) // ✅ repo call, ORM hidden
    const session = await createSession({ userId: user.id }, tx) // ✅ same tx
    return { user, session }
  })
}
```

**Rule:** Services may compose multiple repo calls inside a repo-exposed `withTransaction` wrapper. Services never import the ORM to construct a transaction directly.

---

## Cross-Feature Boundaries

Features do not reach into each other's internals. Cross-feature calls always route through another feature's controllers — **but only the side-effect-free ones** (see below). `.services.ts` and `.repo.ts` are never exported across feature boundaries either way.

```
/features/<feature>/
  <domain>.controllers.ts
  <domain>.services.ts
  <domain>.repo.ts
  <domain>.domain.ts
  lib/
    <domain>.validations.ts
  index.ts   // public API — side-effect-free controller functions + domain types only
```

### HTTP-Bound vs. Exportable Functions

A `.controllers.ts` file naturally contains two kinds of exports:

1. **HTTP-bound handlers** — read/write cookies, headers, or trigger redirects. Called by routes, meant to run inside a real HTTP request. Stay feature-private.
2. **Orchestration functions** — call services, return data, no HTTP side effects. Safe to call from another feature in-process (e.g. one service's workflow needing order data doesn't want a random `redirect()` firing from deep inside another feature's code).

**Only orchestration functions (kind 2) may be re-exported from `index.ts`.** If a controller function has HTTP side effects, keep it feature-private and expose a side-effect-free variant instead.

```ts
// features/order/order.controllers.ts
export async function createOrderAction(formData: unknown) {
  const dto = createOrderSchema.parse(formData)
  const order = await createOrderWithValidation(dto) // service call
  redirect(`/orders/${order.id}`) // ❌ HTTP side effect — this stays feature-private
  return order
}

export async function createOrder(dto: CreateOrderInput) {
  return createOrderWithValidation(dto) // ✅ no HTTP side effects — safe to export
}
```

```ts
// features/order/index.ts
export { createOrder, cancelOrder } from "./order.controllers" // ✅ side-effect-free only
export type { Order, OrderStatus } from "./order.domain" // ✅ + public types
// ❌ never export order.repo.ts or order.services.ts
// ❌ never export createOrderAction — it has HTTP side effects
```

**Rule:** A feature's `index.ts` exports side-effect-free controller functions and public domain types only. `.services.ts` and `.repo.ts` are never exported across feature boundaries. The repo/services boundary is enforceable with ESLint (`no-restricted-imports` blocking deep imports like `features/*/*.services.ts` or `features/*/*.repo.ts` from outside the same feature); the HTTP-bound vs. exportable distinction is a naming/review convention, not something ESLint can check on its own — flag it explicitly in PR review.

---

## File Structure Convention

Each domain (e.g. auth, product, order) follows this structure:

```
/features/<domain>/
  <domain>.controllers.ts    // orchestration & HTTP/session/cookies
  <domain>.services.ts       // business rules & validation
  <domain>.repo.ts           // ORM access, persistence & transactions
  <domain>.domain.ts         // domain types & domain errors
  lib/
    <domain>.validations.ts  // schema definitions
  index.ts                   // public API: side-effect-free controller functions + domain types only

/src/lib/
  <service>.client.ts          // shared external service clients (mailer, stripe, etc.)
  <name>.core.ts                // pure utilities, importable anywhere
  <name>.server.ts              // framework-bound utilities, controllers-only
```

When suggesting new files or refactors, prefer creating missing layers over adding logic to the wrong file.

---

## Core Rules (Strict)

- ❌ No controller → repo calls, ever (not even simple reads — go through a service)
- ❌ No ORM imports outside `*.repo.ts` files
- ❌ No workflow rules outside `*.services.ts` files (see Exceptions below; domain invariants may live in `*.domain.ts`, see section 2/4)
- ❌ No framework API imports in services (cookies, headers, etc.), including `.server.ts` utility files
- ❌ No cross-feature imports of `.services.ts` or `.repo.ts`
- ❌ No HTTP-bound controller functions exported from `index.ts` (see Cross-Feature Boundaries)
- ✅ Creation and validation must be centralized
- ✅ Duplication = immediate extraction to `*.services.ts`
- ✅ Services may call repos for data needed for business decisions
- ✅ Services may call external clients for third-party I/O
- ✅ Controllers handle all HTTP side effects (cookies, redirects, headers)
- ✅ Cross-feature calls route through the target feature's side-effect-free `index.ts` exports

### Exception: Trivial Guards in Controllers

Simple guards may remain inline in controllers when **all** of these conditions are met:

1. **Data check only** — Verifies existence/null, not business logic
2. **No policy name** — Doesn't represent a named rule or security policy
3. **Single use** — No reuse potential across controllers
4. **Obvious intent** — Meaning is clear without a function name

**Allowed inline:**

```ts
// ✅ Simple existence check - no business logic
if (!verificationToken) {
  throw new UnauthorizedError("errors.noVerificationToken")
}

// ✅ Early return for missing optional data
if (!user) {
  return { success: true, data: null } // enumeration prevention
}
```

**Must extract to service:**

```ts
// ❌ Security policy - has a name ("user can only verify own email")
if (currentUser && token.userId !== currentUser.id) {
  throw new UnauthorizedError()
}
// ✅ Extract as:
assertCanVerifyEmail(currentUser?.id ?? null, token.userId)

// ❌ Business rule - checks domain state
if (user.bannedAt) throw new ForbiddenError()
// ✅ Should be part of validateUserCanSignIn() service

// ❌ Reusable validation
if (new Date(token.expiresAt) < new Date()) throw new Error()
// ✅ Should be in verifyUserEmail() service
```

**Rule of thumb:** If you need a comment to explain _why_, extract it. The function name becomes the documentation.

---

## Evolution Rules (Future-Ready)

- Domain logic may later be refactored into entities/classes
- Repositories may later implement interfaces/abstract classes
- Controllers **must remain unchanged** during refactors

Prefer adding seams (extension points) rather than abstractions upfront.

---

## Orchestration Pattern

Controllers should follow this pattern:

1. Parse/validate input (schema from `lib/<domain>.validations.ts`)
2. Call service for business validation/logic
3. Call service for persistence orchestration (the service calls repos/transactions)
4. Handle side effects (emails via clients, cookies, redirects)
5. Return response

Services should:

- Receive data (from controllers or repos)
- Apply business rules
- Return decisions or throw domain errors
- Call repos for data retrieval and persistence needed for business decisions
- Call external clients for third-party I/O
- Never handle HTTP concerns (cookies, headers, redirects)

**Example Flow:**

```ts
// Controller orchestrates
const user = await validateUserCanSignIn(email, password) // Service validates
const session = await startUserSession(user.id) // Service creates session (DB only)
await setSessionCookie(session.token) // Controller handles cookie (side effect)
```

## Decision Principle

- **Logic spans multiple entities or needs repo/client data?** → Put in `*.services.ts`
- **Logic is a single type's own invariant (no external data needed)?** → Put in `*.domain.ts`
- **Logic touches the database?** → Put in `*.repo.ts` (controllers never call this directly)
- **Logic touches HTTP/session/cookies?** → Keep in `.controllers.ts` or a `.server.ts` utility
- **Type or domain error definition?** → Put in `*.domain.ts`
- **Input validation schema?** → Put in `lib/<domain>.validations.ts`
- **Third-party API call, shared across features?** → Put in `src/lib/<service>.client.ts`
- **Third-party API call, feature-specific config?** → Put in `features/<domain>/lib/<service>.client.ts`
- **Pure utility function?** → Put in `<name>.core.ts` (importable anywhere)
- **Framework utility (cookies/headers)?** → Put in `<name>.server.ts` (controllers-only)
- **Multi-step atomic persistence?** → Use `withTransaction` from the repo, composed in the service
- **Needs to be called from another feature?** → Must be a side-effect-free controller export in `index.ts`

---

## Testing Guidance

- **Services**: Unit test with repo functions and clients mocked/stubbed. This is where
  business-rule tests live (e.g. "banned user cannot sign in", "expired token rejected"). No DB
  or network needed.
- **Repos**: Integration test against a real (test) database or in-memory adapter. Tests verify
  mapping correctness (DB row → domain type) and transaction behavior, not business rules.
- **Controllers**: Thin orchestration — test at the integration/e2e level (does the flow work
  end to end), not unit level. Avoid re-testing business rules already covered in service tests.
- **Clients** (`lib/*.client.ts`): Mock in service tests; contract-test separately against the
  real third-party API (sandbox/staging) if critical (e.g. payments).

**Rule of thumb:** if a test needs a real DB connection or network call, it's testing a repo,
a client, or an integration flow — not a service.

---

## Anti-Patterns (Reject & Refactor)

- "Just for now" business logic in controllers
- Any controller importing `*.repo.ts` directly, even for a trivial read
- Exporting ORM models (e.g., `typeof users.$inferSelect`) as domain types
- Utility files mixing pure and framework code in one file instead of a `.core.ts`/`.server.ts` split
- Skipping domain structure because "we'll refactor later"
- Validation logic scattered across multiple files instead of `lib/<domain>.validations.ts`
- Services importing framework utilities (cookies, headers) or `.server.ts` files
- Services handling HTTP side effects (cookies, redirects)
- Services constructing ORM transactions directly instead of using repo's `withTransaction`
- Cross-feature imports of `.services.ts` or `.repo.ts` instead of going through `index.ts`
- An HTTP-bound controller function (cookies/redirects) exported from `index.ts` for cross-feature use
- A domain invariant (single-type, no external data) pulled into a service instead of living in `.domain.ts`
- A workflow rule (needs repo/client data) left in `.domain.ts` instead of moved to a service
- Inline **business rules** in controllers (e.g., `if (user.bannedAt) throw...`) — trivial guards are OK (see Exceptions)
- Inconsistent repo return types (arrays vs single objects)
- Using exceptions as an excuse to avoid extraction — when in doubt, extract

---

## When to Refactor

When you see:

- Same validation called from multiple controllers → Extract to `*.services.ts`
- Database queries duplicated → Consolidate in `*.repo.ts`
- Business rules mixed with HTTP handling → Move to `*.services.ts`
- ORM imports in non-repo files → Move to `*.repo.ts`
- Cookie/session handling in services → Move to controllers
- Inline business logic in controllers → Extract to services (unless trivial guard)
- Inconsistent return types in repos → Standardize (prefer `Promise<T | null>`)
- Comment explaining "why" for inline check → Extract and let function name document intent
- A feature importing another feature's `.services.ts` or `.repo.ts` directly → Route through `index.ts`

Suggest: "This could live in `[domain].services.ts` for reusability."

---

## Summary

**Simple now, structured always, strict later.**

This architecture enables shipping fast — from MVPs to mature codebases — while keeping things evolvable. Each layer has one job. Refactoring future layers doesn't touch stable layers. Naming (`.controllers.ts`, `.domain.ts`) is chosen to read consistently across Next.js, Express, Nest, and similar frameworks.

---

## Quick Reference

| Question                                                | Answer                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| Where does workflow business logic go?                  | `*.services.ts`                                        |
| Where do domain invariants (single-type rules) go?      | `*.domain.ts`                                          |
| Where does database access go?                          | `*.repo.ts`                                            |
| Where do cookies/headers go?                            | `*.controllers.ts` or a `.server.ts` utility           |
| Where do types & domain errors go?                      | `*.domain.ts`                                          |
| Where do validation schemas go?                         | `lib/<domain>.validations.ts`                          |
| Where do shared third-party API calls go?               | `src/lib/<service>.client.ts`                          |
| Where do feature-specific client wrappers go?           | `features/<domain>/lib/<service>.client.ts`            |
| Can controllers call repos?                             | ❌ No — never, not even for a simple read              |
| Can services call repos?                                | ✅ Yes, for data needed for decisions                  |
| Can services call external clients?                     | ✅ Yes, for third-party I/O                            |
| Can services call framework APIs or `.server.ts` files? | ❌ No                                                  |
| Can controllers have inline checks?                     | ✅ Only trivial guards (see Exceptions)                |
| Can utility files mix pure + framework code?            | ❌ No — split into `.core.ts` and `.server.ts`         |
| How are multi-step transactions handled?                | `withTransaction` exposed by repo, composed in service |
| Can features import each other's services/repos?        | ❌ No — only via `index.ts`                            |
| What can `index.ts` export from controllers?            | Only side-effect-free functions (no cookies/redirects) |
