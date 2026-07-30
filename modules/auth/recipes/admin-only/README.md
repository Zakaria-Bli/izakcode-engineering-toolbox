# Admin-only Auth Recipe

Use this when the app has one privileged account type and no customer-facing roles.

## Types

```ts
type AdminRole = "admin"
type AdminPermission = "admin:access" | "users:manage"

type AdminUser = {
  id: string
  email: string
  isActive: boolean
  role: AdminRole
}
```

## Policies

```ts
const policies = {
  canSignIn: (user: AdminUser) => (user.isActive ? true : { allowed: false as const }),
  getRolePermissions: (role: AdminRole): AdminPermission[] => {
    if (role === "admin") return ["admin:access", "users:manage"]
    return []
  },
  getUserEmail: (user: AdminUser) => user.email,
  getUserId: (user: AdminUser) => user.id,
  getUserRole: (user: AdminUser) => user.role,
}
```

## Auth

```ts
const auth = createAuth<AdminUser, string, AdminRole, AdminPermission>({
  config,
  policies,
  repositories,
  ports: {
    passwordHasher,
    tokenGenerator: createNodeTokenGenerator(),
  },
})
```

## Recommended config

```ts
const config = {
  emailVerificationTokenTtlMs: 24 * 60 * 60_000,
  passwordResetTokenTtlMs: 60 * 60_000,
  replaceExistingPasswordResetTokens: true,
  sessionRefreshWindowMs: 5 * 60_000,
  sessionTtlMs: 12 * 60 * 60_000,
  sessionAbsoluteTtlMs: 7 * 24 * 60 * 60_000,
}
```

## Notes

- Keep registration disabled or invite-only.
- Use `requirePermission("admin:access")` on all admin routes.
- Use request-origin enforcement with explicit `trustedOrigins` for cookie-authenticated state-changing routes.
- Implement atomic `tokens.consume` and `repositories.transaction`; password reset fails without transaction support.
- Configure `passwordHasher.verifyDummy` or `dummyPasswordHash`.
