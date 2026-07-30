# Auth Integration Guide

Use this guide when copying `modules/auth` into an app or migrating an app to `@toolbox/auth`.

Public imports stay package-level even though implementation lives in `src/`:

```ts
import { createAuth } from "@toolbox/auth/core"
import type { AuthRepositories, PasswordHasher } from "@toolbox/auth/ports"
import { createRegistrationService } from "@toolbox/auth/services"
import { createExpressAuthAdapter } from "@toolbox/auth/adapters/express"
import { createNextAuthAdapter } from "@toolbox/auth/adapters/next"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"
```

## Integration checklist

1. Define app `User`, `Role`, and `Permission` types.
2. Normalize/validate email and password at the API boundary.
3. Implement `PasswordHasher` with `verifyDummy()` or configure `dummyPasswordHash`.
4. Implement repositories.
5. Implement atomic `tokens.consume()`.
6. Implement `repositories.transaction()` for password reset.
7. Persist `sessions.createdAt` if using `sessionAbsoluteTtlMs`.
8. Persist `tokens.email` for email verification tokens.
9. Create the auth instance.
10. Wire Express or Next adapter.
11. Add route-level rate limits and request-origin checks.

## 1. Define domain types

```ts
type Role = "admin" | "customer"

type Permission = "dashboard:read" | "profile:manage" | "users:manage"

type User = {
  id: string
  email: string
  emailVerified: boolean
  bannedAt: Date | null
  role: Role
  customPermissions?: Permission[]
}
```

## 2. Configure policies

```ts
const policies = {
  canRequestPasswordReset: (user: User) => (user.bannedAt ? { allowed: false as const } : true),

  canSignIn: (user: User) => (user.bannedAt ? { allowed: false as const } : true),

  getRolePermissions: (role: Role): Permission[] => {
    switch (role) {
      case "admin":
        return ["dashboard:read", "profile:manage", "users:manage"]
      case "customer":
        return ["profile:manage"]
    }
  },

  getUserEmail: (user: User) => user.email,
  getUserId: (user: User) => user.id,
  getUserPermissions: (user: User) => user.customPermissions ?? [],
  getUserRole: (user: User) => user.role,
  isEmailVerified: (user: User) => user.emailVerified,

  validatePasswordReset: ({ password }: { password: string }) => {
    if (password.length < 12) {
      throw new Error("Password is too short.")
    }
  },
}
```

## 3. Implement `PasswordHasher`

Auth construction requires either:

- `passwordHasher.verifyDummy(password)`, or
- `config.dummyPasswordHash`

This reduces sign-in timing enumeration for missing emails.

```ts
const passwordHasher: PasswordHasher = {
  hash: (password) => argon2.hash(password),
  verify: (passwordHash, password) => argon2.verify(passwordHash, password),
  verifyDummy: async (password) => {
    await argon2.verify(process.env.DUMMY_PASSWORD_HASH, password)
  },
}
```

See `recipes/password-hashers.md` for more examples.

## 4. Implement repositories

```ts
const repositories: AuthRepositories<User, string> = {
  users: {
    findByEmail,
    findById,
    markEmailVerified,
  },
  credentials: {
    findByEmail,
    updatePasswordHash,
  },
  sessions: {
    create,
    findWithUserById,
    updateExpiry,
    delete,
    deleteManyForUser,
  },
  tokens: {
    create,
    delete,
    deleteManyForUserAndPurpose,
    consume,
  },
  transaction,
}
```

### Session storage

Session IDs are hashed session tokens. Store them as primary keys.

Persist `createdAt` if using `sessionAbsoluteTtlMs`:

```ts
type SessionRow = {
  id: string
  userId: string
  createdAt: Date
  expiresAt: Date
}
```

If `sessionAbsoluteTtlMs` is configured and a persisted session lacks `createdAt`, validation deletes that session.

### Token storage

Token IDs are hashed raw tokens. Raw tokens are sent only through `AuthMailer`.

```ts
type AuthTokenRow = {
  id: string
  userId: string
  purpose: "email_verification" | "password_reset"
  email: string | null
  expiresAt: Date
}
```

For email verification tokens, persist `email`. Core rejects email verification if the user's current email no longer matches the token email.

Password reset tokens do not need `email`.

## 5. Implement atomic `tokens.consume()`

`consume()` must claim and delete a token in one atomic operation.

Postgres / modern SQLite shape:

```sql
DELETE FROM auth_tokens
WHERE id = $1 AND purpose = $2
RETURNING id, user_id, purpose, email, expires_at;
```

If `userId` is provided, include it:

```sql
DELETE FROM auth_tokens
WHERE id = $1 AND purpose = $2 AND user_id = $3
RETURNING id, user_id, purpose, email, expires_at;
```

Repository shape:

```ts
async function consume(input: {
  tokenId: string
  purpose: "email_verification" | "password_reset"
  userId?: string
}) {
  const row = await deleteAndReturnMatchingToken(input)
  return row ? mapToken(row) : null
}
```

No non-atomic fallback exists. Auth construction fails without `tokens.consume`.

## 6. Implement `repositories.transaction()`

Password reset requires a transaction because it coordinates:

- token consume
- session invalidation
- password hash update

```ts
const repositories = {
  // ...repos
  transaction: async (work) => {
    return db.transaction(async (tx) => {
      return runWithTransactionClient(tx, work)
    })
  },
}
```

Exact implementation depends on ORM. The important rule: repository calls inside `work()` must use the transaction-bound DB client.

Password reset fails closed without `repositories.transaction`.

## 7. Create auth

```ts
const auth = createAuth<User, string, Role, Permission>({
  config: {
    emailVerificationTokenTtlMs: 24 * 60 * 60_000,
    passwordResetTokenTtlMs: 60 * 60_000,
    replaceExistingEmailVerificationTokens: true,
    replaceExistingPasswordResetTokens: true,
    sessionRefreshWindowMs: 5 * 60_000,
    sessionTtlMs: 30 * 24 * 60 * 60_000,
    sessionAbsoluteTtlMs: 90 * 24 * 60 * 60_000,

    // Required if passwordHasher.verifyDummy is not implemented.
    dummyPasswordHash: process.env.DUMMY_PASSWORD_HASH,
  },
  policies,
  ports: {
    mailer,
    passwordHasher,
    tokenGenerator: createNodeTokenGenerator(),
  },
  repositories,
})
```

## 8. Registration

Registration is app-owned orchestration around user creation.

```ts
const register = createRegistrationService<User, string, { displayName: string }>({
  passwordHasher,
  createUser: async ({ email, passwordHash, displayName }) => {
    return createUserInDb({
      email,
      passwordHash,
      displayName,
      role: "customer", // server-owned, not client-owned
    })
  },
  createSession: auth.createSession,
  requestEmailVerification: auth.requestEmailVerification,
  transaction: repositories.transaction,
  validateInput: ({ email, password, extra }) => {
    if (!email.includes("@")) throw new Error("Invalid email.")
    if (password.length < 12) throw new Error("Password too short.")
    if (!extra.displayName.trim()) throw new Error("Display name required.")
  },
})
```

Do not spread client request bodies into `extra`. Build `extra` from a server-side allowlist.

Email verification request failure does not fail registration by default. The returned result includes `verificationError`; use `onVerificationError` and an outbox/retry worker for production delivery.

## 9. Sign-in route shape

```ts
async function signInHandler(req, res) {
  await rateLimit(`sign-in:${req.ip}`)

  const email = normalizeEmail(req.body.email)
  const password = req.body.password

  const result = await auth.signIn({ email, password })

  expressAuth.setSessionCookie(res, result.sessionToken)
  res.json({ user: toPublicUser(result.user) })
}
```

Email normalization is app-owned. Do it consistently before `signIn`, registration, password reset, and email verification requests.

## 10. Password reset route shape

Request reset:

```ts
async function requestPasswordResetHandler(req, res) {
  await rateLimit(`password-reset:${req.ip}`)

  await auth.requestPasswordReset({
    email: normalizeEmail(req.body.email),
  })

  // Always safe to return.
  res.json({ ok: true })
}
```

Complete reset:

```ts
async function resetPasswordHandler(req, res) {
  await rateLimit(`password-reset-complete:${req.ip}`)

  const result = await auth.resetPassword({
    token: req.body.token,
    password: req.body.password,

    // Default is true. Let UX choose if product allows keeping other sessions.
    invalidateSessions: req.body.keepOtherSessions ? false : true,
  })

  res.json({ ok: result.passwordReset })
}
```

`invalidateSessionsOnPasswordReset` defaults to true. If invalidation is enabled, implement `sessions.deleteManyForUser`.

## 11. Express integration

```ts
const expressAuth = createExpressAuthAdapter({
  auth,
  cookieName: "session",
  cookieOptions: { secure: true },
  sessionTtlMs: config.sessionTtlMs,
  trustedOrigins: ["https://app.example.com"],
})

app.use(expressAuth.attachAuthContext)

app.post("/account/update", expressAuth.enforceRequestOrigin, expressAuth.requireAuth, handler)

app.get("/admin", expressAuth.requireAuth, expressAuth.requirePermission("users:manage"), handler)
```

For cookie-authenticated state-changing routes, always use `enforceRequestOrigin` with explicit `trustedOrigins`.

Bearer sessions validated through the `Authorization` header may skip origin checks after `validateSession` succeeds. A forged Bearer-shaped header does not bypass origin checks.

## 12. Next integration

```ts
import { cookies } from "next/headers"

const nextAuth = createNextAuthAdapter({
  auth,
  cookieName: "session",
  cookieOptions: { secure: true },
  getCookieStore: () => cookies(),
  sessionTtlMs: config.sessionTtlMs,
  trustedOrigins: ["https://app.example.com"],
})
```

Server action example:

```ts
export async function updateAccountAction(input: UpdateAccountInput) {
  await nextAuth.enforceRequestOrigin({
    headers: await headers(),
    method: "POST",
  })

  const user = await nextAuth.requireAuth()
  await updateAccount(user.id, input)
}
```

Sign out:

```ts
await nextAuth.signOut()
```

## 13. App boundary responsibilities

The module does not own every app concern. Your API layer must handle:

- email trim/case folding and shape validation
- password strength on registration and reset
- rate limits for sign-in, registration, token request, and token completion
- CAPTCHA / bot protection when needed
- audit logging and alerts
- public user serialization
- CSRF/request-origin middleware placement
- DB unique constraints and indexes

## 14. Production readiness checklist

Before shipping:

- [ ] `passwordHasher.verifyDummy` or `dummyPasswordHash` configured
- [ ] `tokens.consume` is atomic and scopes by `id`, `purpose`, and optional `userId`
- [ ] `repositories.transaction` uses transaction-bound repository calls
- [ ] `sessions.deleteManyForUser` implemented if reset invalidates sessions
- [ ] `sessions.createdAt` persisted if using `sessionAbsoluteTtlMs`
- [ ] `auth_tokens.email` persisted for email verification
- [ ] reset/verification emails sent through outbox or retry-capable mailer
- [ ] auth cookies use `secure: true` in production
- [ ] state-changing cookie routes enforce trusted origins
- [ ] sign-in/registration/reset/verification routes rate-limited
- [ ] client-provided registration fields are server-allowlisted
