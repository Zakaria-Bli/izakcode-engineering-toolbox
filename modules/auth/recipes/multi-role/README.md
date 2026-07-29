# Multi-role Auth Recipe

Use this when users can have different roles and optional direct permissions.

## Types

```ts
type Role = "admin" | "manager" | "customer"

type Permission = "dashboard:read" | "users:manage" | "profile:manage" | "billing:manage"

type User = {
  id: string
  email: string
  emailVerified: boolean
  bannedAt: Date | null
  role: Role
  customPermissions?: Permission[]
}
```

## Policies

```ts
const policies = {
  canRequestPasswordReset: (user: User) => (user.bannedAt ? { allowed: false as const } : true),
  canSignIn: (user: User) => (user.bannedAt ? { allowed: false as const } : true),
  getRolePermissions: (role: Role): Permission[] => {
    switch (role) {
      case "admin":
        return ["dashboard:read", "users:manage", "profile:manage", "billing:manage"]
      case "manager":
        return ["dashboard:read", "profile:manage"]
      case "customer":
        return ["profile:manage"]
    }
  },
  getUserEmail: (user: User) => user.email,
  getUserId: (user: User) => user.id,
  getUserPermissions: (user: User) => user.customPermissions ?? [],
  getUserRole: (user: User) => user.role,
  isEmailVerified: (user: User) => user.emailVerified,
}
```

## Permission checks

```ts
auth.hasPermission(user, "dashboard:read")
auth.hasAllPermissions(user, ["dashboard:read", "profile:manage"])
auth.assertPermission(user, "users:manage")
```

## Route guards

Express:

```ts
router.get(
  "/admin",
  expressAuth.attachAuthContext,
  expressAuth.requireAuth,
  expressAuth.requirePermission("users:manage"),
  handler
)
```

Next:

```ts
await nextAuth.requirePermission("users:manage")
```

## Security notes

- Do not accept `role` or `customPermissions` from client-controlled registration `extra` fields.
- Implement atomic `tokens.consume` and `repositories.transaction`; password reset fails without transaction support.
- Configure `passwordHasher.verifyDummy` or `dummyPasswordHash`.
