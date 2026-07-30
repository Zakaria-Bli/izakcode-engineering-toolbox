# Migration Notes: legacy `modules/auth_reference` to `modules/auth`

## Directory layout

Old:

```txt
modules/auth_reference/src/core/*
```

New:

```txt
modules/auth/src/core/*
modules/auth/src/ports/*
modules/auth/src/services/*
modules/auth/src/adapters/*
```

## Import changes

Old:

```ts
import { createAuth } from "../src/core/create-auth.js"
import { createNodeTokenGenerator } from "../src/core/tokens.js"
```

New:

```ts
import { createAuth } from "@toolbox/auth/core"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"
```

## Ports moved

Old:

```txt
src/core/ports.ts
```

New:

```txt
src/ports/ports.ts
```

## Token generator moved

Node crypto no longer lives in `core` or `ports`.

Use direct dependency injection:

```ts
ports: {
  passwordHasher,
  tokenGenerator: createNodeTokenGenerator(),
}
```

## Token repository additions

Recommended new methods:

```ts
consume(input: {
  purpose: AuthTokenPurpose
  tokenId: string
  userId?: UserId
}): Promise<PersistedAuthToken<UserId> | null>
deleteManyForUserAndPurpose?(userId: UserId, purpose: AuthTokenPurpose): Promise<void>
```

`consume()` supports atomic one-time token use and must scope deletion by `id`, `purpose`, and optional `userId`. It is required at auth construction.

`deleteManyForUserAndPurpose()` supports token replacement config:

```ts
replaceExistingEmailVerificationTokens: true
replaceExistingPasswordResetTokens: true
```

## Repository transactions

Password reset can wrap token consume, password update, token deletion, and session invalidation in:

```ts
transaction<Result>(work: () => Promise<Result>): Promise<Result>
```

Implement this with your database transaction mechanism. Without it, password reset fails closed.

## Session repository behavior

Persist `session.createdAt` if using `sessionAbsoluteTtlMs` to cap sliding sessions.

If password reset invalidates sessions, implement:

```ts
deleteManyForUser(userId)
```

If not implemented and invalidation is requested, `resetPassword()` throws.

## Registration service

New service:

```ts
import { createRegistrationService } from "@toolbox/auth/services"
```

It supports:

- password hashing
- user creation
- optional separate credential save
- optional session creation
- optional email verification request
- `validateInput`
- `transaction`
- `rollbackUser`
- best-effort verification error handling

See:

```txt
src/services/registration.md
```

## New fail-closed defaults

- Configure `passwordHasher.verifyDummy` or `dummyPasswordHash`; auth construction fails without one of them.
- Implement `tokens.consume`; auth construction fails without it.
- Implement `repositories.transaction`; password reset fails without it.
