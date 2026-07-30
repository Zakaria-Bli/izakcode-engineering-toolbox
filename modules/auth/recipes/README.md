# Auth Recipes

Recipes describe app-level integration patterns. They are not core code.

## Recipes

- `admin-only/` — single-role admin auth.
- `multi-role/` — multiple roles and permissions.
- `password-hashers.md` — `PasswordHasher` implementations.
- `drizzle-postgres-admin/` — Drizzle/Postgres repository shape for admin auth.
- `drizzle-sqlite-multirole/` — Drizzle/SQLite repository shape for multi-role apps.
- `migration-notes.md` — notes for moving from legacy `modules/auth_reference` to `modules/auth`.

## Composition order

```txt
1. define User, Role, Permission types
2. implement repositories with atomic `tokens.consume` and `repositories.transaction`
3. implement `PasswordHasher` with `verifyDummy` or configure `dummyPasswordHash`
4. choose TokenGenerator adapter
5. create auth core
6. create registration service if needed
7. wrap with Express/Next adapter
```

## Import paths

```ts
import { createAuth } from "@toolbox/auth/core"
import type { AuthRepositories } from "@toolbox/auth/ports"
import { createRegistrationService } from "@toolbox/auth/services"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"
```
