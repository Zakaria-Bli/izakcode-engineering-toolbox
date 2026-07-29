# Auth Module

Status: internal blueprint module.

`@toolbox/auth` is a framework-agnostic authentication module built around clean architecture, ports, services, and adapters.

It provides:

- email/password sign-in
- password registration orchestration
- password hashing through an injected `PasswordHasher`
- session creation, validation, refresh, and invalidation
- hashed token persistence contracts
- email verification tokens
- password reset tokens
- role/permission helpers
- Express-like and Next-like adapters
- Node token-generator adapter

## Architecture

```txt
modules/auth/
├── src/
│   ├── core/             # pure auth workflows, domain helpers, errors, type re-exports
│   ├── domain/           # shared domain types used by core and ports
│   ├── ports/            # interfaces for side effects and persistence
│   ├── services/         # application services that orchestrate workflows
│   └── adapters/         # framework/runtime integration
├── tests/                # core, service, adapter, type, export tests
├── examples/             # integration examples
└── recipes/              # app-specific implementation guidance
```

Dependency rule:

```txt
domain defines shared data contracts.
core/services depend on domain, ports, and pure helpers.
ports depend on domain types only.
adapters depend inward and hold runtime/framework details.
```

Node crypto lives only in:

```txt
src/adapters/node/token-generator.ts
```

## Entry points

```ts
import { createAuth } from "@toolbox/auth/core"
import type { AuthRepositories, PasswordHasher } from "@toolbox/auth/ports"
import { createRegistrationService } from "@toolbox/auth/services"
import { createExpressAuthAdapter } from "@toolbox/auth/adapters/express"
import { createNextAuthAdapter } from "@toolbox/auth/adapters/next"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"
```

Root export also re-exports `core`, `ports`, and `services` for convenience.

## Quick start

```ts
import { createAuth } from "@toolbox/auth/core"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"

const auth = createAuth({
  config: {
    emailVerificationTokenTtlMs: 86_400_000,
    passwordResetTokenTtlMs: 3_600_000,
    sessionRefreshWindowMs: 5 * 60_000,
    sessionTtlMs: 30 * 24 * 60 * 60_000,
    sessionAbsoluteTtlMs: 90 * 24 * 60 * 60_000,
    sessionTokenByteLength: 32,
    emailVerificationTokenByteLength: 32,
    passwordResetTokenByteLength: 32,
    replaceExistingEmailVerificationTokens: true,
    replaceExistingPasswordResetTokens: true,
  },
  policies,
  ports: {
    passwordHasher,
    tokenGenerator: createNodeTokenGenerator(),
  },
  repositories,
})
```

## Registration

```ts
import { createRegistrationService } from "@toolbox/auth/services"

const register = createRegistrationService({
  passwordHasher,
  createUser: async ({ email, passwordHash, displayName }) => {
    return db.user.create({
      data: { email, passwordHash, displayName },
    })
  },
  createSession: auth.createSession,
  requestEmailVerification: auth.requestEmailVerification,
  validateInput: ({ email, password }) => {
    if (!email.includes("@")) throw new Error("Invalid email.")
    if (password.length < 12) throw new Error("Password too short.")
  },
})

const result = await register({
  email: "user@example.com",
  password: "correct horse battery staple",
  // Build this object from a server-side allowlist. Never spread client bodies into `extra`.
  extra: { displayName: "Ada" },
})
```

Detailed integration and registration docs:

```txt
INTEGRATION.md
src/services/registration.md
```

## Token lifecycle

Tokens are stored hashed. Raw tokens are delivered only through the injected `AuthMailer`
(`sendEmailVerification` / `sendPasswordReset`), never in `requestEmailVerification` /
`requestPasswordReset` return values.

Those request helpers always return a uniform `{ ok: true }` so HTTP handlers can pass the
result through without leaking user existence, user records, or raw secrets.

```ts
await auth.requestPasswordReset({ email })
// => { ok: true }

// Wire delivery via ports.mailer — do not reconstruct tokens in route handlers.
```

Repository support:

```ts
tokens: {
  create(token)
  delete(tokenId)
  consume({ tokenId, purpose, userId })
  deleteManyForUserAndPurpose?(userId, purpose)
}
```

Recommended production implementation:

- implement `consume({ tokenId, purpose, userId })` atomically for one-time token use; SQL should include `WHERE id = ? AND purpose = ?` and `user_id` when provided
- implement `repositories.transaction()` so password reset updates, token deletion, and session invalidation commit atomically; password reset fails closed without transaction support
- implement `deleteManyForUserAndPurpose()` if token replacement config is enabled
- use DB unique/index constraints for user email and credential ownership
- store the email value on email-verification tokens so old-email tokens cannot verify a changed email
- prefer an outbox for email delivery; direct mailer failure returns `{ ok: true }` and compensates by deleting the just-created token

## Session invalidation after password reset

Default behavior:

```ts
invalidateSessionsOnPasswordReset: true
```

If reset invalidation is enabled, repository must implement:

```ts
sessions.deleteManyForUser(userId)
```

Without it, `resetPassword()` throws instead of falsely reporting session invalidation.

Callers can still make an explicit per-request UX choice:

```ts
await auth.resetPassword({
  invalidateSessions: keepOtherSessions ? false : true,
  password,
  token,
})
```

## Adapters

### Express-like

```ts
const expressAuth = createExpressAuthAdapter({
  auth,
  cookieName: "session",
  cookieOptions: { secure: true }, // httpOnly/path/sameSite default safely
  sessionTtlMs: config.sessionTtlMs, // optional: derives cookie maxAge
  trustedOrigins: ["https://app.example.com"],
})
```

Provides:

- `attachAuthContext`
- `requireAuth`
- `requirePermission`
- `enforceRequestOrigin`
- cookie helpers

### Next-like

```ts
const nextAuth = createNextAuthAdapter({
  auth,
  cookieName: "session",
  cookieOptions: { secure: true }, // httpOnly/path/sameSite default safely
  getCookieStore: () => cookies(),
  sessionTtlMs: config.sessionTtlMs, // optional: derives cookie maxAge
  trustedOrigins: ["https://app.example.com"],
})
```

Provides:

- `getCurrentUser`
- `requireAuth`
- `requirePermission`
- `enforceRequestOrigin`
- `signOut`
- cookie helpers

## Validation stance

Core auth validates auth-state invariants, token expiry, permissions, and policy decisions.

App-level validation remains app-owned:

- email shape and normalization (trim/case folding before calling auth)
- password strength
- registration profile fields
- CAPTCHA/rate limits

Use `createRegistrationService({ validateInput })`, `policies.validatePasswordReset`, or validation at the API boundary.

## Tests

```sh
pnpm --filter @toolbox/auth typecheck
pnpm --filter @toolbox/auth lint
pnpm --filter @toolbox/auth test
```

Coverage includes:

- core auth flows
- registration orchestration/failure handling
- Express adapter
- Next adapter
- Node token generator
- subpath export smoke test
- registration type-level ergonomics

## Security notes

- Hash session/password-reset/email-verification tokens before storage.
- Use secure password hashing implementation through `PasswordHasher`.
- Configure `passwordHasher.verifyDummy` or `dummyPasswordHash`; auth construction fails without dummy verification.
- Auth config rejects token byte lengths below 32 and invalid TTL/refresh-window/absolute-lifetime values.
- Cookie helpers default to `httpOnly: true`, `path: "/"`, `sameSite: "lax"`, and require `secure: true` in production.
- Use HTTPS and secure cookies in production.
- Enforce CSRF/request-origin checks for cookie-authenticated state-changing requests with explicit `trustedOrigins`.
- `enforceRequestOrigin` skips origin checks only for safe methods or Bearer sessions that pass `validateSession`; a forged `Authorization` header alone does not bypass CSRF protection.
- Express cookie helpers mutate cookies only for cookie-sourced sessions; invalid Bearer headers do not clear valid cookies.
- Use `sessionAbsoluteTtlMs` to cap sliding sessions.
- Rate-limit registration, sign-in, password reset, and verification endpoints at adapter/API layer.
- Prefer transactional persistence for user + credential creation.
- Prefer outbox/retry for email delivery.
