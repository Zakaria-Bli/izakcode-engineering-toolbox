import type { AuthId, AuthSession, AuthTokenRequestResult } from "../domain/types.js"
import type { PasswordHasher } from "../ports/ports.js"

type Simplify<Type> = {
  [Key in keyof Type]: Type[Key]
} & {}

type ReservedRegistrationExtraKeys = "email" | "password" | "passwordHash"
export type RegistrationExtra<Extra extends object> = Omit<Extra, ReservedRegistrationExtraKeys>
type RequiredKeys<Type extends object> = {
  [Key in keyof Type]-?: Record<string, never> extends Pick<Type, Key> ? never : Key
}[keyof Type]

type RegisterExtraInput<Extra extends object> = keyof RegistrationExtra<Extra> extends never
  ? { extra?: never }
  : RequiredKeys<RegistrationExtra<Extra>> extends never
    ? { extra?: RegistrationExtra<Extra> }
    : { extra: RegistrationExtra<Extra> }

export type RegisterWithPasswordInput<Extra extends object = Record<never, never>> = Simplify<
  {
    email: string
    password: string
  } & RegisterExtraInput<Extra>
>

export type CreateUserWithPasswordInput<Extra extends object = Record<never, never>> = Simplify<
  RegistrationExtra<Extra> & {
    email: string
    passwordHash: string
  }
>

export interface RegisterWithPasswordFailureContext<User, UserId extends AuthId> {
  email: string
  error: unknown
  user: User
  userId: UserId
}

export interface RegisterWithPasswordValidationInput<Extra extends object = Record<never, never>> {
  email: string
  extra: RegistrationExtra<Extra>
  password: string
}

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

export interface RegisterWithPasswordConfig<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
> extends RegisterWithPasswordConfigBase<User, UserId, Extra> {
  getUserId: (user: User) => UserId
}

export type RegisterWithPasswordConfigWithId<
  User extends { id: UserId },
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
> = RegisterWithPasswordConfigBase<User, UserId, Extra> & {
  getUserId?: (user: User) => UserId
}

export interface RegisterWithPasswordResult<User, UserId extends AuthId> {
  session?: AuthSession<UserId>
  sessionToken?: string
  user: User
  verificationError?: unknown
  verificationTokenResult?: AuthTokenRequestResult
}

interface PersistedRegistration<User, UserId extends AuthId> {
  sessionResult?: {
    session: AuthSession<UserId>
    sessionToken: string
  }
  user: User
  userId: UserId
}

function getRegistrationExtra<Extra extends object>(
  input: RegisterWithPasswordInput<Extra>
): RegistrationExtra<Extra> {
  return ((input as { extra?: RegistrationExtra<Extra> }).extra ?? {}) as RegistrationExtra<Extra>
}

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

/** Creates a password registration workflow from injected persistence, hashing, and optional side-effect hooks. */
export function createRegistrationService<
  User extends { id: UserId },
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
>(
  config: RegisterWithPasswordConfigWithId<User, UserId, Extra>
): (input: RegisterWithPasswordInput<Extra>) => Promise<RegisterWithPasswordResult<User, UserId>>
export function createRegistrationService<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
>(
  config: RegisterWithPasswordConfig<User, UserId, Extra>
): (input: RegisterWithPasswordInput<Extra>) => Promise<RegisterWithPasswordResult<User, UserId>>
export function createRegistrationService<
  User,
  UserId extends AuthId,
  Extra extends object = Record<never, never>,
>(
  config: RegisterWithPasswordConfigBase<User, UserId, Extra> & {
    getUserId?: (user: User) => UserId
  }
) {
  return async function registerWithPassword(
    input: RegisterWithPasswordInput<Extra>
  ): Promise<RegisterWithPasswordResult<User, UserId>> {
    const email = input.email
    const extraFields = getRegistrationExtra(input)

    await config.validateInput?.({
      email,
      extra: extraFields,
      password: input.password,
    })

    const passwordHash = await config.passwordHasher.hash(input.password)

    const persistRegistration = async (): Promise<PersistedRegistration<User, UserId>> => {
      let created: { user: User; userId: UserId } | undefined

      try {
        const user = await config.createUser({
          ...extraFields,
          email,
          passwordHash,
        } as CreateUserWithPasswordInput<Extra>)
        const userId = config.getUserId?.(user) ?? getDefaultUserId<User, UserId>(user)
        created = { user, userId }

        if (config.saveCredential) {
          await config.saveCredential(userId, passwordHash)
        }

        const sessionResult = config.createSession ? await config.createSession(userId) : undefined

        return {
          sessionResult,
          user,
          userId,
        }
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
    }

    const persisted = config.transaction
      ? await config.transaction(persistRegistration)
      : await persistRegistration()

    let verificationError: unknown
    let verificationTokenResult: AuthTokenRequestResult | undefined

    if (config.requestEmailVerification) {
      try {
        verificationTokenResult = await config.requestEmailVerification({
          email,
          user: persisted.user,
          userId: persisted.userId,
        })
      } catch (error) {
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
      }
    }

    return {
      session: persisted.sessionResult?.session,
      sessionToken: persisted.sessionResult?.sessionToken,
      user: persisted.user,
      verificationError,
      verificationTokenResult,
    }
  }
}
