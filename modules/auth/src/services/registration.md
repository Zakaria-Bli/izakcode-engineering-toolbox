# Password Registration Service

File: `modules/auth/src/services/registration.ts`

This document explains every exported type, internal helper, and runtime step in the password registration service.

## Purpose

`registration.ts` provides a framework-agnostic application service for password-based user registration.

It does not know about Express, Next.js, databases, ORMs, queues, cookies, or email providers. Instead, it orchestrates injected functions:

1. hash password
2. create user
3. derive user id
4. optionally save credential
5. optionally create session
6. optionally request email verification
7. return created user and optional auth artifacts

Email shape and normalization stay app-owned (normalize in `validateInput` or at the API boundary before calling the service).

The service sits above `core` and `ports`:

```txt
services/registration.ts
  ├─ imports auth domain types from domain/types.ts
  └─ imports PasswordHasher port from ports/ports.ts
```

## Imports

```ts
import type { AuthId, AuthSession, AuthTokenRequestResult } from "../domain/types.js"
import type { PasswordHasher } from "../ports/ports.js"
```

### `AuthId`

Core auth id type:

```ts
export type AuthId = number | string
```

All user ids handled by this service must be `string` or `number`.

### `AuthSession<UserId>`

Returned when registration creates a session.

### `AuthTokenRequestResult`

Returned when registration requests an email verification token.

### `PasswordHasher`

Port interface used to hash the plain password:

```ts
export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(passwordHash: string, password: string): Promise<boolean>
  verifyDummy?(password: string): Promise<void>
}
```

Registration uses only `hash()`.

## Internal type helpers

### `Simplify<Type>`

```ts
type Simplify<Type> = {
  [Key in keyof Type]: Type[Key]
} & {}
```

Purpose: flatten intersection types in editor hover output.

Without `Simplify`, users may see types like:

```ts
{ email: string; password: string } & { extra: { name: string } }
```

With `Simplify`, hover output is cleaner:

```ts
{
  email: string
  password: string
  extra: {
    name: string
  }
}
```

It changes type display only. It does not change runtime behavior.

### `ReservedRegistrationExtraKeys`

```ts
type ReservedRegistrationExtraKeys = "email" | "password" | "passwordHash"
```

These keys are protected.

Reason:

- `email` must come from caller-provided `input.email` (app-normalized if desired)
- `password` must never be forwarded to `createUser()`
- `passwordHash` must come from `passwordHasher.hash(input.password)`

External `extra` data must not override these fields.

### `RegistrationExtra<Extra>`

```ts
type RegistrationExtra<Extra extends object> = Omit<Extra, ReservedRegistrationExtraKeys>
```

Removes protected keys from caller-provided extra data.

Example:

```ts
type Extra = {
  email: string
  passwordHash: string
  displayName: string
}

type SafeExtra = RegistrationExtra<Extra>
// { displayName: string }
```

This is compile-time protection. Runtime protection also exists because `createUser()` input spreads extra fields first, then writes `email` and `passwordHash` after.

### `RequiredKeys<Type>`

```ts
type RequiredKeys<Type extends object> = {
  [Key in keyof Type]-?: Record<string, never> extends Pick<Type, Key> ? never : Key
}[keyof Type]
```

Detects which keys in an object type are required.

Used to decide whether `input.extra` should itself be required.

Example:

```ts
type Extra = { displayName: string; referralCode?: string }
type Keys = RequiredKeys<Extra>
// "displayName"
```

If `Extra` has required keys, registration input must include `extra`.

If `Extra` has only optional keys, registration input may omit `extra`.

### `RegisterExtraInput<Extra>`

```ts
type RegisterExtraInput<Extra extends object> = keyof RegistrationExtra<Extra> extends never
  ? { extra?: never }
  : RequiredKeys<RegistrationExtra<Extra>> extends never
    ? { extra?: RegistrationExtra<Extra> }
    : { extra: RegistrationExtra<Extra> }
```

This conditional type creates the correct shape for the `extra` field.

#### Case 1: no extra fields

```ts
type Input = RegisterWithPasswordInput
```

Result:

```ts
{
  email: string
  password: string
  extra?: never
}
```

Users should not pass `extra`.

#### Case 2: optional extra fields only

```ts
type Input = RegisterWithPasswordInput<{
  referralCode?: string
}>
```

Result:

```ts
{
  email: string
  password: string
  extra?: {
    referralCode?: string
  }
}
```

Users may omit `extra`.

#### Case 3: required extra fields

```ts
type Input = RegisterWithPasswordInput<{
  displayName: string
  referralCode?: string
}>
```

Result:

```ts
{
  email: string
  password: string
  extra: {
    displayName: string
    referralCode?: string
  }
}
```

Users must pass `extra.displayName`.

## Exported types

## `RegisterWithPasswordInput<Extra>`

```ts
export type RegisterWithPasswordInput<Extra extends object = Record<never, never>> = Simplify<
  {
    email: string
    password: string
  } & RegisterExtraInput<Extra>
>
```

Input accepted by returned `registerWithPassword()` function.

### Fields

| Field      |               Type |    Required | Meaning                                                     |
| ---------- | -----------------: | ----------: | ----------------------------------------------------------- |
| `email`    |           `string` |         yes | Raw email from caller. Not normalized by this service.      |
| `password` |           `string` |         yes | Plain password. Service hashes it before persistence.       |
| `extra`    | depends on `Extra` | conditional | Additional user profile fields. Reserved auth keys omitted. |

### Default `Extra`

```ts
Record<never, never>
```

This means no extra fields by default.

Example:

```ts
const register = createRegistrationService({ ... })

await register({
  email: "user@example.com",
  password: "secret",
})
```

No `extra` needed.

## `CreateUserWithPasswordInput<Extra>`

```ts
export type CreateUserWithPasswordInput<Extra extends object = Record<never, never>> = Simplify<
  RegistrationExtra<Extra> & {
    email: string
    passwordHash: string
  }
>
```

Input passed to `config.createUser()`.

It contains:

- caller-provided `email`
- hashed password as `passwordHash`
- safe extra fields

It does not contain plain `password`.

Example:

```ts
type Extra = {
  displayName: string
  marketingOptIn?: boolean
}

// createUser receives:
{
  email: string
  passwordHash: string
  displayName: string
  marketingOptIn?: boolean
}
```

## `RegisterWithPasswordFailureContext<User, UserId>`

```ts
export interface RegisterWithPasswordFailureContext<User, UserId extends AuthId> {
  email: string
  error: unknown
  user: User
  userId: UserId
}
```

Context passed to failure hooks.

Used by:

- `rollbackUser`
- `onVerificationError`

### Fields

| Field    | Meaning                                 |
| -------- | --------------------------------------- |
| `email`  | Normalized email used for registration. |
| `error`  | Original error that triggered the hook. |
| `user`   | Created user object.                    |
| `userId` | Derived user id.                        |

## `RegisterWithPasswordValidationInput<Extra>`

```ts
export interface RegisterWithPasswordValidationInput<Extra extends object = Record<never, never>> {
  email: string
  extra: RegistrationExtra<Extra>
  password: string
}
```

Input passed to `validateInput`.

It contains caller-provided `email`, plain `password` for strength checks, and safe extra fields.

## `RegisterWithPasswordConfigBase<User, UserId, Extra>`

```ts
export interface RegisterWithPasswordConfigBase<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
> {
  createSession?: (
    userId: UserId
  ) => Promise<{ session: AuthSession<UserId>; sessionToken: string }>
  createUser: (input: CreateUserWithPasswordInput<Extra>) => Promise<User>
  failOnVerificationError?: boolean
  onVerificationError?: (
    context: RegisterWithPasswordFailureContext<User, UserId>
  ) => Promise<void> | void
  passwordHasher: PasswordHasher
  requestEmailVerification?: (input: {
    email: string
    user: User
    userId: UserId
  }) => Promise<AuthTokenRequestResult>
  rollbackUser?: (context: RegisterWithPasswordFailureContext<User, UserId>) => Promise<void> | void
  saveCredential?: (userId: UserId, passwordHash: string) => Promise<void>
  transaction?: <Result>(work: () => Promise<Result>) => Promise<Result>
  validateInput?: (input: RegisterWithPasswordValidationInput<Extra>) => Promise<void> | void
}
```

Base config shared by both overloads.

### `createUser`

Required.

Creates the application user.

Receives email, password hash, and extra fields:

```ts
createUser: async ({ email, passwordHash, displayName }) => {
  return db.user.create({
    data: {
      email,
      passwordHash,
      displayName,
    },
  })
}
```

Architecture note: some systems store `passwordHash` on the user table. Others store it in a separate credential table. This service supports both:

- store hash in `createUser()` only
- store hash in `saveCredential()` only
- store hash in both if your schema needs both, though usually avoid duplicate storage

### `passwordHasher`

Required.

Used before user creation:

```ts
const passwordHash = await config.passwordHasher.hash(input.password)
```

Plain password is never passed to `createUser()`.

### `validateInput`

Optional.

Runs after extra extraction, but before password hashing or persistence. Use this hook for email shape/normalization checks.

Use it for app-owned validation:

- email shape
- password strength
- profile field constraints
- tenant/invite checks

Example:

```ts
validateInput: ({ email, password, extra }) => {
  if (!email.includes("@")) throw new ValidationError("Invalid email.")
  if (password.length < 12) throw new ValidationError("Password too short.")
  if ("displayName" in extra && !extra.displayName) {
    throw new ValidationError("Display name is required.")
  }
}
```

If `validateInput` throws, registration stops before hashing, user creation, credential persistence, session creation, or verification.

### `saveCredential`

Optional.

Persists credential separately from user.

Typical use:

```ts
saveCredential: async (userId, passwordHash) => {
  await db.credential.create({
    data: {
      userId,
      passwordHash,
      provider: "password",
    },
  })
}
```

If omitted, `createUser()` is expected to persist enough password auth data.

### `createSession`

Optional.

Creates a session immediately after registration.

Compatible with `createAuth().createSession`:

```ts
const auth = createAuth(...)

const register = createRegistrationService({
  createSession: auth.createSession,
  ...
})
```

If omitted, registration returns no `session` and no `sessionToken`.

### `requestEmailVerification`

Optional.

Requests an email verification token after user persistence succeeds.

Signature:

```ts
requestEmailVerification?: (input: {
  email: string
  user: User
  userId: UserId
}) => Promise<AuthTokenRequestResult>
```

It receives `user` and `userId` to avoid re-querying the just-created user.

It is still compatible with `auth.requestEmailVerification`, because that function only needs `{ email }` and can ignore extra fields:

```ts
requestEmailVerification: auth.requestEmailVerification
```

### `failOnVerificationError`

Optional.

Default:

```ts
false
```

Controls what happens if `requestEmailVerification()` throws.

When `false` or omitted:

- registration still succeeds
- returned result includes `verificationError`
- `verificationTokenResult` remains `undefined`

When `true`:

- verification error is thrown
- registration caller receives rejection
- user may already be created

Use `true` only when email verification delivery must block account creation.

### `onVerificationError`

Optional.

Hook called when `requestEmailVerification()` throws.

Useful for:

- logging
- metrics
- enqueueing retry job
- creating admin alert

Example:

```ts
onVerificationError: ({ email, error, userId }) => {
  logger.warn("Email verification request failed.", {
    email,
    error,
    userId,
  })
}
```

### `rollbackUser`

Optional.

Called when user creation succeeded but a later persistence step failed and no `transaction` was provided.

Later persistence steps include:

- `saveCredential`
- `createSession`

Example:

```ts
rollbackUser: async ({ userId }) => {
  await db.user.delete({ where: { id: userId } })
}
```

If rollback itself fails, the service throws an `AggregateError` containing both:

1. original registration error
2. rollback error

### `transaction`

Optional.

Wraps persistence operations:

- `createUser`
- `saveCredential`
- `createSession`

Example:

```ts
transaction: async (work) => {
  return db.$transaction(async () => work())
}
```

If provided, the service does not call `rollbackUser` on persistence failure. It assumes transaction infrastructure handles rollback.

Important: `requestEmailVerification()` runs after `transaction` completes. This prevents email sending from happening inside the database transaction.

## `RegisterWithPasswordConfig<User, UserId, Extra>`

```ts
export interface RegisterWithPasswordConfig<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
> extends RegisterWithPasswordConfigBase<User, UserId, Extra> {
  getUserId: (user: User) => UserId
}
```

Used when `User` does not guarantee an `id` property.

Example:

```ts
type User = {
  user_id: string
  email: string
}

createRegistrationService<User, string>({
  getUserId: (user) => user.user_id,
  ...
})
```

## `RegisterWithPasswordConfigWithId<User, UserId, Extra>`

```ts
export type RegisterWithPasswordConfigWithId<
  User extends { id: UserId },
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
> = RegisterWithPasswordConfigBase<User, UserId, Extra> & {
  getUserId?: (user: User) => UserId
}
```

Used when user object already has an `id` property.

Example:

```ts
type User = {
  id: string
  email: string
}

createRegistrationService<User, string>({
  // getUserId optional here
  ...
})
```

The implementation still validates `user.id` at runtime if `getUserId` is omitted.

## `RegisterWithPasswordResult<User, UserId>`

```ts
export interface RegisterWithPasswordResult<User, UserId extends AuthId> {
  session?: AuthSession<UserId>
  sessionToken?: string
  user: User
  verificationError?: unknown
  verificationTokenResult?: AuthTokenRequestResult
}
```

Return value from `registerWithPassword()`.

### Fields

| Field                     | Present when                                                                     | Meaning                                  |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| `user`                    | always on success                                                                | Created user.                            |
| `session`                 | `createSession` configured and succeeds                                          | Persisted auth session object.           |
| `sessionToken`            | `createSession` configured and succeeds                                          | Raw session token for cookie/header.     |
| `verificationTokenResult` | `requestEmailVerification` configured and succeeds                               | Email verification token request result. |
| `verificationError`       | `requestEmailVerification` throws and `failOnVerificationError` is false/omitted | Captured verification failure.           |

## Internal runtime helpers

## `PersistedRegistration<User, UserId>`

```ts
interface PersistedRegistration<User, UserId extends AuthId> {
  sessionResult?: {
    session: AuthSession<UserId>
    sessionToken: string
  }
  user: User
  userId: UserId
}
```

Internal result from persistence phase.

It contains the durable registration data needed by post-persistence side effects.

## `getRegistrationExtra(input)`

```ts
function getRegistrationExtra<Extra extends object>(
  input: RegisterWithPasswordInput<Extra>
): RegistrationExtra<Extra> {
  return ((input as { extra?: RegistrationExtra<Extra> }).extra ?? {}) as RegistrationExtra<Extra>
}
```

Extracts `input.extra` or returns empty object.

The type cast exists because `RegisterWithPasswordInput<Extra>` is conditional. TypeScript cannot always prove `extra` exists or does not exist across all generic cases.

Runtime behavior:

- if `input.extra` exists, use it
- otherwise, use `{}`

## `getDefaultUserId(user)`

```ts
function getDefaultUserId<User, UserId extends AuthId>(user: User): UserId {
  if (typeof user !== "object" || user === null || !("id" in user)) {
    throw new Error("Registration service requires getUserId or a user.id value.")
  }

  const id = (user as { id?: unknown }).id

  if (typeof id !== "string" && typeof id !== "number") {
    throw new Error("Registration service requires getUserId or a string/number user.id value.")
  }

  return id as UserId
}
```

Fallback used when `config.getUserId` is omitted.

Runtime checks:

1. `user` must be a non-null object
2. `user` must contain key `id`
3. `user.id` must be `string` or `number`

If any check fails, registration throws.

This prevents accidental `undefined` user ids.

## `rollbackCreatedUser(config, context)`

```ts
async function rollbackCreatedUser<User, UserId extends AuthId>(
  config: Pick<RegisterWithPasswordConfigBase<User, UserId, object>, "rollbackUser">,
  context: RegisterWithPasswordFailureContext<User, UserId>
): Promise<void> {
  if (!config.rollbackUser) {
    return
  }

  try {
    await config.rollbackUser(context)
  } catch (rollbackError) {
    throw new AggregateError(
      [context.error, rollbackError],
      "Registration failed and rollback failed.",
      { cause: rollbackError }
    )
  }
}
```

Calls `rollbackUser` safely.

Behavior:

- if no `rollbackUser`, do nothing
- if rollback succeeds, original error is rethrown by caller
- if rollback fails, throw `AggregateError`

`AggregateError` preserves both errors so debugging does not lose the original cause.

## `createRegistrationService()` overloads

There are two public call signatures.

### Overload 1: `User` has `id`

```ts
export function createRegistrationService<
  User extends { id: UserId },
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
>(
  config: RegisterWithPasswordConfigWithId<User, UserId, Extra>
): (input: RegisterWithPasswordInput<Extra>) => Promise<RegisterWithPasswordResult<User, UserId>>
```

If `User` has `id`, `getUserId` is optional.

### Overload 2: custom id selector required

```ts
export function createRegistrationService<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
>(
  config: RegisterWithPasswordConfig<User, UserId, Extra>
): (input: RegisterWithPasswordInput<Extra>) => Promise<RegisterWithPasswordResult<User, UserId>>
```

If `User` does not guarantee `id`, `getUserId` is required.

### Implementation signature

```ts
export function createRegistrationService<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
>(
  config: RegisterWithPasswordConfigBase<User, UserId, Extra> & {
    getUserId?: (user: User) => UserId
  }
) {
  return async function registerWithPassword(...) { ... }
}
```

The implementation signature is wider than public overloads. This is normal TypeScript overload design.

External callers see the safer overloads. Internal implementation handles both cases.

## Runtime flow

Calling `createRegistrationService(config)` returns one function:

```ts
registerWithPassword(input)
```

Full flow:

```txt
registerWithPassword(input)
  ├─ extract extra fields
  ├─ validate input?              optional (app-owned email shape/normalization)
  ├─ hash password
  ├─ persist registration
  │   ├─ create user
  │   ├─ derive user id
  │   ├─ save credential?          optional
  │   └─ create session?           optional
  ├─ request email verification?   optional, post-persistence
  └─ return result
```

## Step-by-step execution

### Step 1: use caller-provided email

```ts
const email = input.email
```

The service does not trim or case-fold email. Apps should normalize before calling, or inside `validateInput`.

### Step 2: extract extra fields

```ts
const extraFields = getRegistrationExtra(input)
```

If input has no `extra`, this returns `{}`.

### Step 3: optionally validate input

```ts
await config.validateInput?.({
  email,
  extra: extraFields,
  password: input.password,
})
```

If validation fails, registration stops before hashing or persistence.

### Step 4: hash password

```ts
const passwordHash = await config.passwordHasher.hash(input.password)
```

The service does not persist plain password.

If hashing fails, registration stops immediately.

At this point:

- no user has been created
- no credential has been saved
- no session has been created
- no verification token has been requested

### Step 5: define persistence function

```ts
const persistRegistration = async (): Promise<PersistedRegistration<User, UserId>> => { ... }
```

Persistence is wrapped in a function so it can be executed either:

- directly
- inside `config.transaction`

### Step 6: create local `created` tracker

```ts
let created: { user: User; userId: UserId } | undefined
```

This is used only for rollback.

It stays `undefined` until user creation and user id derivation succeed.

### Step 7: call `createUser()`

```ts
const user = await config.createUser({
  ...extraFields,
  email,
  passwordHash,
} as CreateUserWithPasswordInput<Extra>)
```

Field order matters.

`extraFields` is spread first. `email` and `passwordHash` are assigned after. Therefore even if unsafe runtime input contains `extra.email` or `extra.passwordHash`, the caller email and generated hash win.

The cast exists because generic conditional types plus object spread are hard for TypeScript to prove.

### Step 8: derive `userId`

```ts
const userId = config.getUserId?.(user) ?? getDefaultUserId<User, UserId>(user)
```

Priority:

1. use configured `getUserId(user)` if present
2. otherwise fallback to validated `user.id`

If neither works, registration throws.

### Step 9: mark user as created

```ts
created = { user, userId }
```

After this point, rollback may run if later persistence fails and no transaction exists.

### Step 10: optionally save credential

```ts
if (config.saveCredential) {
  await config.saveCredential(userId, passwordHash)
}
```

If `saveCredential` fails:

- with `transaction`: transaction should roll back
- without `transaction`: `rollbackUser` is called if provided
- original error is thrown unless rollback also fails

### Step 11: optionally create session

```ts
const sessionResult = config.createSession ? await config.createSession(userId) : undefined
```

If configured, creates logged-in session after registration.

If `createSession` fails:

- with `transaction`: transaction should roll back
- without `transaction`: `rollbackUser` is called if provided
- error is thrown

### Step 12: return persisted registration

```ts
return {
  sessionResult,
  user,
  userId,
}
```

This completes durable registration persistence.

### Step 13: catch persistence errors

```ts
} catch (error) {
  if (!config.transaction && created) {
    await rollbackCreatedUser(config, {
      email,
      error,
      user: created.user,
      userId: created.userId,
    })
  }

  throw error
}
```

Rollback only runs when:

- no `transaction` is configured
- user was created and user id was derived
- a later persistence step failed

Rollback does not run when:

- password hashing fails
- `createUser()` fails before returning user
- `getUserId()` fails before `created` is set
- `transaction` is configured

### Step 14: execute persistence directly or inside transaction

```ts
const persisted = config.transaction
  ? await config.transaction(persistRegistration)
  : await persistRegistration()
```

If transaction is provided, it owns atomicity for persistence steps.

### Step 15: initialize verification outputs

```ts
let verificationError: unknown
let verificationTokenResult: AuthTokenRequestResult | undefined
```

These are filled only if email verification is configured.

### Step 16: optionally request email verification

```ts
if (config.requestEmailVerification) {
  try {
    verificationTokenResult = await config.requestEmailVerification({
      email,
      user: persisted.user,
      userId: persisted.userId,
    })
  } catch (error) {
    ...
  }
}
```

This happens after persistence succeeds.

Why after persistence?

- avoids sending email for rolled-back user
- avoids doing external side effect inside DB transaction
- supports outbox/retry architecture

### Step 17: handle verification error

```ts
verificationError = error
await config.onVerificationError?.({
  email,
  error,
  user: persisted.user,
  userId: persisted.userId,
})

if (config.failOnVerificationError ?? false) {
  throw error
}
```

Behavior depends on `failOnVerificationError`.

Default behavior:

```ts
config.failOnVerificationError ?? false
```

So omitted means `false`.

If `false`, keep registration successful and return `verificationError`.

If `true`, throw verification error.

### Step 18: return final result

```ts
return {
  session: persisted.sessionResult?.session,
  sessionToken: persisted.sessionResult?.sessionToken,
  user: persisted.user,
  verificationError,
  verificationTokenResult,
}
```

Optional chaining means missing optional features produce `undefined` fields.

## Failure matrix

| Failure point                                                      |         User created? |     Credential saved? |      Session created? | Verification requested? | Behavior                                                                        |
| ------------------------------------------------------------------ | --------------------: | --------------------: | --------------------: | ----------------------: | ------------------------------------------------------------------------------- |
| `validateInput` throws                                             |                    no |                    no |                    no |                      no | throw error                                                                     |
| `passwordHasher.hash` throws                                       |                    no |                    no |                    no |                      no | throw error                                                                     |
| `createUser` throws                                                |             maybe not |                    no |                    no |                      no | throw error; no rollback because no returned user                               |
| `getUserId` throws                                                 |                   yes |                    no |                    no |                      no | throw error; no rollback because `created` not set yet                          |
| `saveCredential` throws, no transaction                            |                   yes |            no/partial |                    no |                      no | call `rollbackUser` if provided, then throw                                     |
| `saveCredential` throws, with transaction                          | transaction-dependent | transaction-dependent |                    no |                      no | transaction handles rollback, throw                                             |
| `createSession` throws, no transaction                             |                   yes |                   yes |            no/partial |                      no | call `rollbackUser` if provided, then throw                                     |
| `createSession` throws, with transaction                           | transaction-dependent | transaction-dependent | transaction-dependent |                      no | transaction handles rollback, throw                                             |
| `requestEmailVerification` throws, default config                  |                   yes |     yes if configured |     yes if configured |                  failed | call `onVerificationError` if provided, return success with `verificationError` |
| `requestEmailVerification` throws, `failOnVerificationError: true` |                   yes |     yes if configured |     yes if configured |                  failed | call `onVerificationError`, throw                                               |

## Atomicity model

The service distinguishes two classes of work.

### Persistence work

Persistence work can be transactional:

- user creation
- credential save
- session creation

Configured by:

```ts
transaction?: <Result>(work: () => Promise<Result>) => Promise<Result>
```

### Side-effect work

Email verification is side-effect work:

- token request
- mail send
- queue enqueue

It runs after persistence.

This is intentional. External side effects usually should not run inside database transactions.

Recommended production pattern:

1. transaction creates user + credential + verification token/outbox row
2. commit transaction
3. worker sends email from outbox
4. retry on mail failure

## Usage examples

## Minimal registration with user table password hash

```ts
type User = {
  id: string
  email: string
  passwordHash: string
}

const register = createRegistrationService<User, string>({
  passwordHasher,
  createUser: async ({ email, passwordHash }) => {
    return db.user.create({
      data: {
        email,
        passwordHash,
      },
    })
  },
})

const result = await register({
  email: " USER@Example.COM ",
  password: "secret",
})
```

## Registration with separate credential table

```ts
type User = {
  id: string
  email: string
}

const register = createRegistrationService<User, string>({
  passwordHasher,
  createUser: async ({ email }) => {
    return db.user.create({ data: { email } })
  },
  saveCredential: async (userId, passwordHash) => {
    await db.credential.create({
      data: {
        userId,
        passwordHash,
        provider: "password",
      },
    })
  },
})
```

## Registration with required profile fields

```ts
type User = {
  id: string
  email: string
  displayName: string
}

type Extra = {
  displayName: string
  marketingOptIn?: boolean
}

const register = createRegistrationService<User, string, Extra>({
  passwordHasher,
  createUser: async ({ email, passwordHash, displayName, marketingOptIn }) => {
    return db.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        marketingOptIn: marketingOptIn ?? false,
      },
    })
  },
})

await register({
  email: "user@example.com",
  password: "secret",
  extra: {
    displayName: "Ada Lovelace",
  },
})
```

Because `displayName` is required in `Extra`, `extra` is required in registration input.

## Registration with custom id field

```ts
type User = {
  user_id: number
  email: string
}

const register = createRegistrationService<User, number>({
  passwordHasher,
  getUserId: (user) => user.user_id,
  createUser: async ({ email, passwordHash }) => {
    return db.user.create({
      data: {
        email,
        passwordHash,
      },
    })
  },
})
```

Because `User` has no `id` property, `getUserId` is required.

## Registration that signs in immediately

```ts
const auth = createAuth(...)

const register = createRegistrationService<User, string>({
  passwordHasher,
  createSession: auth.createSession,
  createUser: async ({ email, passwordHash }) => {
    return db.user.create({ data: { email, passwordHash } })
  },
})

const result = await register({
  email: "user@example.com",
  password: "secret",
})

setCookie("session", result.sessionToken)
```

## Registration with email verification

```ts
const auth = createAuth(...)

const register = createRegistrationService<User, string>({
  passwordHasher,
  createUser: async ({ email, passwordHash }) => {
    return db.user.create({ data: { email, passwordHash } })
  },
  requestEmailVerification: auth.requestEmailVerification,
})
```

`auth.requestEmailVerification` only needs `{ email }`; extra `user` and `userId` are harmless.

## Registration with best-effort email verification (default)

```ts
const register = createRegistrationService<User, string>({
  passwordHasher,
  createUser,
  requestEmailVerification,
  onVerificationError: ({ email, error }) => {
    logger.warn("Verification email failed.", { email, error })
  },
})

const result = await register({
  email: "user@example.com",
  password: "secret",
})

if (result.verificationError) {
  // user exists; show "account created, email delayed" UI
}
```

## Registration with manual rollback

```ts
const register = createRegistrationService<User, string>({
  passwordHasher,
  createUser,
  saveCredential,
  rollbackUser: async ({ userId }) => {
    await db.user.delete({ where: { id: userId } })
  },
})
```

Use this only when real transaction support is unavailable.

## Registration with transaction

```ts
const register = createRegistrationService<User, string>({
  passwordHasher,
  createUser,
  saveCredential,
  createSession,
  transaction: async (work) => {
    return db.$transaction(async () => work())
  },
})
```

Note: exact transaction implementation depends on ORM/database. Many ORMs require transaction-bound repositories/functions. In that case, create transaction-aware closures before calling `work()`.

## Design decisions

### Why is this in `services/`?

Registration is an orchestration workflow, not a pure domain helper.

It coordinates multiple ports and core auth behaviors. That makes it an application service.

### Why is `PasswordHasher` injected?

Hashing implementation is infrastructure-specific.

Examples:

- Argon2
- bcrypt
- scrypt
- test hasher

The service only depends on the port.

### Why does `createUser()` receive `passwordHash`?

Some apps store password hash directly on user row. Others ignore this field and use `saveCredential()`.

This keeps service flexible.

If your architecture requires strict separation, implement `createUser()` to ignore `passwordHash` and persist credential in `saveCredential()`.

### Why is email verification after persistence?

Because email sending is an external side effect.

Doing it after persistence avoids sending verification email for a user that later rolls back.

### Why does verification get `user` and `userId`?

The service already has them. Passing them avoids unnecessary lookup and enables custom verification implementations.

### Why not always require transactions?

Not every adapter/database layer has easy transaction support. The service supports both:

- proper transaction when available
- rollback hook fallback when not available

### Why default `failOnVerificationError` to `false`?

Email delivery is an external side effect. Account creation should not be reported as failed after user and credential persistence have already committed. Capture `verificationError`, log through `onVerificationError`, and retry delivery through an outbox or background job. Set `failOnVerificationError: true` only when product policy requires email delivery to block registration.

## Security notes

- Plain password is used only for hashing.
- `createUser()` receives `passwordHash`, never plain password.
- `extra` cannot override caller `email` or generated `passwordHash` because both type-level omission and runtime assignment order protect them.
- Build `extra` from a server-side allowlist. Do not spread client request bodies into `extra`, especially for fields such as `role`, `isActive`, or permissions.
- Email shape and normalization are app-owned. Core/services pass `input.email` through unchanged.
- Credential persistence should enforce unique email/user constraints at database level.
- Registration should rate-limit at adapter/API layer. This service does not rate-limit.
- Password strength validation should happen before or inside this service depending on product policy. Current service only hashes password.

## Known caveats

### `createUser()` failure after partial DB write

If `createUser()` itself partially writes and then throws, this service cannot know returned user/userId. `rollbackUser` will not run.

Fix at repository layer: make `createUser()` atomic or use `transaction`.

### `getUserId()` failure after user creation

If `getUserId()` throws, `created` has not been set yet, so `rollbackUser` does not run.

Best fix: provide reliable `getUserId` or return user shape with valid `id`.

### `createSession()` inside transaction

If `createSession` uses a separate storage system from user/credential persistence, wrapping it in the same transaction may not give true atomicity.

In that case, consider creating session after transaction or using compensating cleanup.

### Verification failure after successful persistence

If verification throws and `failOnVerificationError` is true, caller sees failure even though user may exist.

Default behavior avoids this by returning success with `verificationError`. Production systems should still use background retry/outbox for email delivery.

## Testing coverage

Current tests cover:

- successful registration with extra fields
- credential persistence
- session creation
- email verification request
- rollback when credential persistence fails
- best-effort verification error handling
- required/optional `Extra` field type behavior
- reserved auth key omission in `extra`
- `getUserId` required for users without `id`
- `getUserId` optional when user exposes `id`

Recommended additional tests:

- runtime failure when `user.id` missing
- transaction prevents rollback hook call
- rollback failure throws `AggregateError`

## Summary

`registration.ts` is a clean application service for password registration. It keeps framework/database/email details injected, protects auth-critical fields, supports transactional persistence, offers rollback fallback, and treats email verification as a post-persistence side effect.
