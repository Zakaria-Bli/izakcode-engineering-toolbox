import type {
  AuthLogger,
  AuthPolicyDecision,
  CreateAuthOptions,
  PasswordHasher,
  TokenGenerator,
} from "../ports/ports.js"
import { getDefaultClock, getDefaultUserIdComparator } from "../ports/ports.js"
import {
  AuthConfigurationError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTokenError,
  TokenExpiredError,
  ValidationError,
} from "./errors.js"
import {
  assertPermission as assertPermissionFromList,
  hasAllPermissions as hasAllPermissionsFromList,
  hasAnyPermission as hasAnyPermissionFromList,
  hasPermission as hasPermissionFromList,
  uniquePermissions,
} from "./permissions.js"
import { createExpiryDate, isExpired, shouldRefresh } from "./sessions.js"
import { isTokenPurpose } from "./tokens.js"
import type {
  AuthConfig,
  AuthId,
  AuthSession,
  AuthTokenPurpose,
  AuthTokenRequestResult,
  PersistedAuthToken,
  PersistedSession,
  RequestEmailVerificationInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  ResetPasswordResult,
  SignInInput,
  SignInResult,
  SignOutInput,
  ValidateSessionInput,
  ValidateSessionResult,
  VerifyEmailInput,
  VerifyEmailResult,
} from "./types.js"

function assertAllowed(decision: AuthPolicyDecision | undefined, fallbackMessage: string): void {
  if (decision === undefined || decision === true) {
    return
  }

  throw new ForbiddenError(decision.message ?? fallbackMessage, decision.code ?? "auth.forbidden")
}

async function runDummyPasswordVerification(
  passwordHasher: PasswordHasher,
  password: string,
  dummyPasswordHash?: string
): Promise<void> {
  if (passwordHasher.verifyDummy) {
    await passwordHasher.verifyDummy(password)
    return
  }

  if (dummyPasswordHash) {
    await passwordHasher.verify(dummyPasswordHash, password)
  }
}

function buildSession<UserId extends AuthId>(
  session: PersistedSession<UserId>,
  fresh: boolean
): AuthSession<UserId> {
  return {
    ...session,
    fresh,
  }
}

function buildToken<UserId extends AuthId>(input: {
  email?: string
  expiresAt: Date
  id: string
  purpose: PersistedAuthToken<UserId>["purpose"]
  userId: UserId
}): PersistedAuthToken<UserId> {
  return {
    ...(input.email === undefined ? {} : { email: input.email }),
    expiresAt: input.expiresAt,
    id: input.id,
    purpose: input.purpose,
    userId: input.userId,
  }
}

function getTokenReplacementFlag(config: {
  replaceExistingEmailVerificationTokens?: boolean
  replaceExistingPasswordResetTokens?: boolean
}): (purpose: AuthTokenPurpose) => boolean {
  return (purpose) => {
    if (purpose === "email_verification") {
      return config.replaceExistingEmailVerificationTokens ?? false
    }

    return config.replaceExistingPasswordResetTokens ?? false
  }
}

const MIN_TOKEN_BYTE_LENGTH = 32

type NormalizedAuthConfig = AuthConfig & {
  emailVerificationTokenByteLength: number
  passwordResetTokenByteLength: number
  sessionTokenByteLength: number
}

function assertPositiveDurationMs(name: keyof AuthConfig, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${name} must be a positive finite number.`, { field: name })
  }
}

function assertOptionalPositiveDurationMs(name: keyof AuthConfig, value: number | undefined): void {
  if (value === undefined) {
    return
  }

  assertPositiveDurationMs(name, value)
}

function assertRefreshWindowMs(value: number, sessionTtlMs: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError("sessionRefreshWindowMs must be a non-negative finite number.", {
      field: "sessionRefreshWindowMs",
    })
  }

  if (value >= sessionTtlMs) {
    throw new ValidationError("sessionRefreshWindowMs must be less than sessionTtlMs.", {
      field: "sessionRefreshWindowMs",
    })
  }
}

function normalizeTokenByteLength(name: keyof AuthConfig, value: number | undefined): number {
  const normalizedValue = value ?? MIN_TOKEN_BYTE_LENGTH

  if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_TOKEN_BYTE_LENGTH) {
    throw new ValidationError(`${name} must be an integer of at least ${MIN_TOKEN_BYTE_LENGTH}.`, {
      field: name,
      min: MIN_TOKEN_BYTE_LENGTH,
    })
  }

  return normalizedValue
}

function normalizeAuthConfig(config: AuthConfig): NormalizedAuthConfig {
  assertPositiveDurationMs("emailVerificationTokenTtlMs", config.emailVerificationTokenTtlMs)
  assertPositiveDurationMs("passwordResetTokenTtlMs", config.passwordResetTokenTtlMs)
  assertPositiveDurationMs("sessionTtlMs", config.sessionTtlMs)
  assertOptionalPositiveDurationMs("sessionAbsoluteTtlMs", config.sessionAbsoluteTtlMs)
  assertRefreshWindowMs(config.sessionRefreshWindowMs, config.sessionTtlMs)

  if (
    config.sessionAbsoluteTtlMs !== undefined &&
    config.sessionAbsoluteTtlMs < config.sessionTtlMs
  ) {
    throw new ValidationError("sessionAbsoluteTtlMs must be at least sessionTtlMs.", {
      field: "sessionAbsoluteTtlMs",
    })
  }

  return {
    ...config,
    emailVerificationTokenByteLength: normalizeTokenByteLength(
      "emailVerificationTokenByteLength",
      config.emailVerificationTokenByteLength
    ),
    passwordResetTokenByteLength: normalizeTokenByteLength(
      "passwordResetTokenByteLength",
      config.passwordResetTokenByteLength
    ),
    sessionTokenByteLength: normalizeTokenByteLength(
      "sessionTokenByteLength",
      config.sessionTokenByteLength
    ),
  }
}

function logAuthEvent(
  logger: AuthLogger | undefined,
  level: keyof AuthLogger,
  message: string,
  context?: Record<string, unknown>
): void {
  try {
    const log = logger?.[level]
    log?.(message, context)
  } catch {
    // Logging must never change auth behavior.
  }
}

export interface AuthInstance<User, UserId extends AuthId, Permission extends string> {
  assertPermission(user: User, permission: Permission): void
  createSession(userId: UserId): Promise<{
    session: AuthSession<UserId>
    sessionToken: string
  }>
  hasAllPermissions(user: User, permissions: readonly Permission[]): boolean
  hasAnyPermission(user: User, permissions: readonly Permission[]): boolean
  hasPermission(user: User, permission: Permission): boolean
  requestEmailVerification(input: RequestEmailVerificationInput): Promise<AuthTokenRequestResult>
  requestPasswordReset(input: RequestPasswordResetInput): Promise<AuthTokenRequestResult>
  resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult<UserId>>
  signIn(input: SignInInput): Promise<SignInResult<User, UserId>>
  signOut(input: SignOutInput): Promise<void>
  validateSession(input: ValidateSessionInput): Promise<ValidateSessionResult<User, UserId>>
  verifyEmail(input: VerifyEmailInput<UserId>): Promise<VerifyEmailResult<UserId>>
}

/** Creates framework-agnostic auth workflows from injected ports, repositories, and policies. */
export function createAuth<User, UserId extends AuthId, Role, Permission extends string>(
  options: CreateAuthOptions<User, UserId, Role, Permission>
): AuthInstance<User, UserId, Permission> {
  const config = normalizeAuthConfig(options.config)
  const clock = options.ports.clock ?? getDefaultClock()
  const logger = options.ports.logger
  const tokenGenerator: TokenGenerator = options.ports.tokenGenerator
  const areUserIdsEqual = options.policies.areUserIdsEqual ?? getDefaultUserIdComparator<UserId>()
  const shouldReplaceExistingTokens = getTokenReplacementFlag(config)

  if (!options.ports.passwordHasher.verifyDummy && !config.dummyPasswordHash) {
    throw new ValidationError(
      "Configure passwordHasher.verifyDummy or dummyPasswordHash to reduce sign-in timing enumeration.",
      { field: "ports.passwordHasher.verifyDummy" }
    )
  }

  if (!options.repositories.tokens.consume) {
    throw new AuthConfigurationError("tokens.consume is required for one-time token safety.", {
      field: "repositories.tokens.consume",
    })
  }

  function getUserPermissions(user: User): Permission[] {
    return uniquePermissions([
      ...options.policies.getRolePermissions(options.policies.getUserRole(user)),
      ...(options.policies.getUserPermissions?.(user) ?? []),
    ])
  }

  async function createSession(userId: UserId): Promise<{
    session: AuthSession<UserId>
    sessionToken: string
  }> {
    const now = clock.now()
    const sessionToken = tokenGenerator.generate(config.sessionTokenByteLength)
    const sessionToPersist: PersistedSession<UserId> = {
      createdAt: now,
      expiresAt: createExpiryDate(config.sessionTtlMs, now),
      id: tokenGenerator.hash(sessionToken),
      userId,
    }

    const persistedSession = await options.repositories.sessions.create(sessionToPersist)

    return {
      session: buildSession(persistedSession, false),
      sessionToken,
    }
  }

  async function replaceExistingTokensForPurpose(
    userId: UserId,
    purpose: AuthTokenPurpose
  ): Promise<void> {
    if (!shouldReplaceExistingTokens(purpose)) {
      return
    }

    if (!options.repositories.tokens.deleteManyForUserAndPurpose) {
      throw new AuthConfigurationError(
        "Token replacement requires tokens.deleteManyForUserAndPurpose repository support.",
        { field: "repositories.tokens.deleteManyForUserAndPurpose" }
      )
    }

    await options.repositories.tokens.deleteManyForUserAndPurpose(userId, purpose)
  }

  function isUsableToken(
    token: PersistedAuthToken<UserId> | null,
    input: {
      purpose: AuthTokenPurpose
      userId?: UserId
    }
  ): token is PersistedAuthToken<UserId> {
    if (!token || !isTokenPurpose(token.purpose, input.purpose)) {
      return false
    }

    return input.userId === undefined || areUserIdsEqual(input.userId, token.userId)
  }

  async function findTokenForUse(input: {
    purpose: AuthTokenPurpose
    tokenId: string
    userId?: UserId
  }): Promise<{
    consumedAtomically: boolean
    token: PersistedAuthToken<UserId> | null
  }> {
    const consumedToken = await options.repositories.tokens.consume(input)

    if (!isUsableToken(consumedToken, input)) {
      return {
        consumedAtomically: true,
        token: null,
      }
    }

    return {
      consumedAtomically: true,
      token: consumedToken,
    }
  }

  async function deleteTokenAfterUse(
    token: PersistedAuthToken<UserId>,
    consumedAtomically: boolean
  ): Promise<void> {
    if (consumedAtomically) {
      return
    }

    await options.repositories.tokens.delete(token.id)
  }

  async function runInRepositoryTransaction<Result>(work: () => Promise<Result>): Promise<Result> {
    return options.repositories.transaction ? options.repositories.transaction(work) : work()
  }

  async function runDummyTokenRequestWork(byteLength: number): Promise<void> {
    const token = tokenGenerator.generate(byteLength)
    tokenGenerator.hash(token)
  }

  async function deleteTokenAfterDeliveryFailure(tokenId: string): Promise<void> {
    try {
      await options.repositories.tokens.delete(tokenId)
    } catch (error) {
      logAuthEvent(logger, "error", "auth.token_delivery_compensation_failed", { error })
    }
  }

  async function validateEmailVerificationTokenBinding(
    token: PersistedAuthToken<UserId>,
    consumedAtomically: boolean
  ): Promise<void> {
    if (!token.email) {
      await deleteTokenAfterUse(token, consumedAtomically)
      logAuthEvent(logger, "warn", "auth.email_verification_failed", {
        reason: "missing_email_binding",
      })
      throw new InvalidTokenError()
    }

    const user = await options.repositories.users.findById(token.userId)

    if (!user || options.policies.getUserEmail(user) !== token.email) {
      await deleteTokenAfterUse(token, consumedAtomically)
      logAuthEvent(logger, "warn", "auth.email_verification_failed", {
        reason: "email_binding_mismatch",
      })
      throw new InvalidTokenError()
    }
  }

  async function signIn(input: SignInInput): Promise<SignInResult<User, UserId>> {
    const email = input.email
    const authRecord = await options.repositories.credentials.findByEmail(email)

    if (!authRecord) {
      await runDummyPasswordVerification(
        options.ports.passwordHasher,
        input.password,
        config.dummyPasswordHash
      )
      logAuthEvent(logger, "warn", "auth.sign_in_failed", { reason: "invalid_credentials" })
      throw new InvalidCredentialsError()
    }

    const isValidPassword = await options.ports.passwordHasher.verify(
      authRecord.passwordHash,
      input.password
    )

    if (!isValidPassword) {
      logAuthEvent(logger, "warn", "auth.sign_in_failed", { reason: "invalid_credentials" })
      throw new InvalidCredentialsError()
    }

    const signInDecision = options.policies.canSignIn?.(authRecord.user)

    if (signInDecision !== undefined && signInDecision !== true) {
      logAuthEvent(logger, "warn", "auth.sign_in_failed", {
        code: signInDecision.code ?? "auth.forbidden",
        reason: "policy_denied",
      })
    }

    assertAllowed(signInDecision, "User cannot sign in.")

    const userId = options.policies.getUserId(authRecord.user)
    const sessionResult = await createSession(userId)

    return {
      ...sessionResult,
      user: authRecord.user,
    }
  }

  async function validateSession(
    input: ValidateSessionInput
  ): Promise<ValidateSessionResult<User, UserId>> {
    if (!input.sessionToken) {
      return {
        session: null,
        shouldRefreshCookie: false,
        user: null,
      }
    }

    const sessionId = tokenGenerator.hash(input.sessionToken)
    const result = await options.repositories.sessions.findWithUserById(sessionId)

    if (!result) {
      return {
        session: null,
        shouldRefreshCookie: false,
        user: null,
      }
    }

    const now = clock.now()

    if (config.sessionAbsoluteTtlMs !== undefined) {
      if (!result.session.createdAt) {
        await options.repositories.sessions.delete(result.session.id)
        return {
          session: null,
          shouldRefreshCookie: false,
          user: null,
        }
      }

      const absoluteExpiresAt = createExpiryDate(
        config.sessionAbsoluteTtlMs,
        result.session.createdAt
      )

      if (isExpired(absoluteExpiresAt, now)) {
        await options.repositories.sessions.delete(result.session.id)
        return {
          session: null,
          shouldRefreshCookie: false,
          user: null,
        }
      }
    }

    if (isExpired(result.session.expiresAt, now)) {
      await options.repositories.sessions.delete(result.session.id)
      return {
        session: null,
        shouldRefreshCookie: false,
        user: null,
      }
    }

    try {
      assertAllowed(options.policies.canSignIn?.(result.user), "User cannot maintain a session.")
    } catch (error) {
      if (!(error instanceof ForbiddenError)) {
        throw error
      }

      logAuthEvent(logger, "info", "auth.session_revoked", { reason: "policy_denied" })
      await options.repositories.sessions.delete(result.session.id)
      return {
        session: null,
        shouldRefreshCookie: false,
        user: null,
      }
    }

    let expiresAt = result.session.expiresAt
    let fresh = false

    if (shouldRefresh(expiresAt, config.sessionRefreshWindowMs, now)) {
      let nextExpiresAt = createExpiryDate(config.sessionTtlMs, now)

      if (config.sessionAbsoluteTtlMs !== undefined && result.session.createdAt) {
        const absoluteExpiresAt = createExpiryDate(
          config.sessionAbsoluteTtlMs,
          result.session.createdAt
        )

        if (nextExpiresAt.getTime() > absoluteExpiresAt.getTime()) {
          nextExpiresAt = absoluteExpiresAt
        }
      }

      if (nextExpiresAt.getTime() > expiresAt.getTime()) {
        expiresAt = nextExpiresAt
        fresh = true
        await options.repositories.sessions.updateExpiry(result.session.id, expiresAt)
      }
    }

    return {
      session: buildSession(
        {
          ...result.session,
          expiresAt,
        },
        fresh
      ),
      shouldRefreshCookie: fresh,
      user: result.user,
    }
  }

  async function signOut(input: SignOutInput): Promise<void> {
    if (!input.sessionToken) {
      return
    }

    await options.repositories.sessions.delete(tokenGenerator.hash(input.sessionToken))
  }

  async function requestEmailVerification(
    input: RequestEmailVerificationInput
  ): Promise<AuthTokenRequestResult> {
    const email = input.email
    const user = await options.repositories.users.findByEmail(email)

    if (!user || options.policies.isEmailVerified?.(user)) {
      await runDummyTokenRequestWork(config.emailVerificationTokenByteLength)
      return { ok: true }
    }

    const userId = options.policies.getUserId(user)
    const deliveryEmail = options.policies.getUserEmail(user)
    const token = tokenGenerator.generate(config.emailVerificationTokenByteLength)
    const tokenId = tokenGenerator.hash(token)
    const expiresAt = createExpiryDate(config.emailVerificationTokenTtlMs, clock.now())

    await runInRepositoryTransaction(async () => {
      await replaceExistingTokensForPurpose(userId, "email_verification")
      await options.repositories.tokens.create(
        buildToken({
          email: deliveryEmail,
          expiresAt,
          id: tokenId,
          purpose: "email_verification",
          userId,
        })
      )
    })

    try {
      await options.ports.mailer?.sendEmailVerification({
        email: deliveryEmail,
        expiresAt,
        token,
        user,
        userId,
      })
    } catch (error) {
      logAuthEvent(logger, "error", "auth.email_verification_delivery_failed", { error })
      await deleteTokenAfterDeliveryFailure(tokenId)
    }

    return { ok: true }
  }

  async function verifyEmail(input: VerifyEmailInput<UserId>): Promise<VerifyEmailResult<UserId>> {
    const markEmailVerified = options.repositories.users.markEmailVerified

    if (!markEmailVerified) {
      throw new AuthConfigurationError(
        "Email verification requires users.markEmailVerified repository support.",
        { field: "repositories.users.markEmailVerified" }
      )
    }

    const tokenId = tokenGenerator.hash(input.token)
    const expectedUserId = input.currentUserId ?? undefined

    return await runInRepositoryTransaction(async () => {
      const { consumedAtomically, token: persistedToken } = await findTokenForUse({
        purpose: "email_verification",
        tokenId,
        ...(expectedUserId === undefined ? {} : { userId: expectedUserId }),
      })

      if (!persistedToken) {
        logAuthEvent(logger, "warn", "auth.email_verification_failed", {
          reason: "invalid_token",
        })
        throw new InvalidTokenError()
      }

      if (isExpired(persistedToken.expiresAt, clock.now())) {
        await deleteTokenAfterUse(persistedToken, consumedAtomically)
        logAuthEvent(logger, "warn", "auth.email_verification_failed", {
          reason: "expired_token",
        })
        throw new TokenExpiredError()
      }

      await validateEmailVerificationTokenBinding(persistedToken, consumedAtomically)
      await markEmailVerified(persistedToken.userId, true)
      await deleteTokenAfterUse(persistedToken, consumedAtomically)

      return {
        userId: persistedToken.userId,
        verified: true,
      }
    })
  }

  async function requestPasswordReset(
    input: RequestPasswordResetInput
  ): Promise<AuthTokenRequestResult> {
    const email = input.email
    const user = await options.repositories.users.findByEmail(email)

    if (!user) {
      await runDummyTokenRequestWork(config.passwordResetTokenByteLength)
      return { ok: true }
    }

    const resetDecision = options.policies.canRequestPasswordReset?.(user)

    if (resetDecision !== undefined && resetDecision !== true) {
      logAuthEvent(logger, "warn", "auth.password_reset_request_denied", {
        code: resetDecision.code ?? "auth.forbidden",
        reason: "policy_denied",
      })
      await runDummyTokenRequestWork(config.passwordResetTokenByteLength)
      return { ok: true }
    }

    const userId = options.policies.getUserId(user)
    const deliveryEmail = options.policies.getUserEmail(user)
    const token = tokenGenerator.generate(config.passwordResetTokenByteLength)
    const tokenId = tokenGenerator.hash(token)
    const expiresAt = createExpiryDate(config.passwordResetTokenTtlMs, clock.now())

    await runInRepositoryTransaction(async () => {
      await replaceExistingTokensForPurpose(userId, "password_reset")
      await options.repositories.tokens.create(
        buildToken({
          expiresAt,
          id: tokenId,
          purpose: "password_reset",
          userId,
        })
      )
    })

    try {
      await options.ports.mailer?.sendPasswordReset({
        email: deliveryEmail,
        expiresAt,
        token,
        user,
        userId,
      })
    } catch (error) {
      logAuthEvent(logger, "error", "auth.password_reset_delivery_failed", { error })
      await deleteTokenAfterDeliveryFailure(tokenId)
    }

    return { ok: true }
  }

  async function resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResult<UserId>> {
    const shouldInvalidateSessions =
      input.invalidateSessions ?? config.invalidateSessionsOnPasswordReset ?? true
    const deleteManyForUser = options.repositories.sessions.deleteManyForUser

    if (shouldInvalidateSessions && !deleteManyForUser) {
      throw new AuthConfigurationError(
        "Password reset session invalidation requires sessions.deleteManyForUser repository support.",
        { field: "repositories.sessions.deleteManyForUser" }
      )
    }

    if (!options.repositories.transaction) {
      throw new AuthConfigurationError(
        "Password reset requires repositories.transaction for atomic token, credential, and session updates.",
        { field: "repositories.transaction" }
      )
    }

    await options.policies.validatePasswordReset?.({ password: input.password })

    const tokenId = tokenGenerator.hash(input.token)

    return await runInRepositoryTransaction(async () => {
      const { consumedAtomically, token: persistedToken } = await findTokenForUse({
        purpose: "password_reset",
        tokenId,
      })

      if (!persistedToken) {
        logAuthEvent(logger, "warn", "auth.password_reset_failed", { reason: "invalid_token" })
        throw new InvalidTokenError()
      }

      if (isExpired(persistedToken.expiresAt, clock.now())) {
        await deleteTokenAfterUse(persistedToken, consumedAtomically)
        logAuthEvent(logger, "warn", "auth.password_reset_failed", { reason: "expired_token" })
        throw new TokenExpiredError()
      }

      let sessionsInvalidated = false

      if (shouldInvalidateSessions && deleteManyForUser) {
        await deleteManyForUser(persistedToken.userId)
        sessionsInvalidated = true
      }

      const passwordHash = await options.ports.passwordHasher.hash(input.password)
      await options.repositories.credentials.updatePasswordHash(persistedToken.userId, passwordHash)
      await deleteTokenAfterUse(persistedToken, consumedAtomically)

      return {
        passwordReset: true,
        sessionsInvalidated,
        userId: persistedToken.userId,
      }
    })
  }

  function hasPermission(user: User, permission: Permission): boolean {
    return hasPermissionFromList(getUserPermissions(user), permission)
  }

  function hasAnyPermission(user: User, permissions: readonly Permission[]): boolean {
    return hasAnyPermissionFromList(getUserPermissions(user), permissions)
  }

  function hasAllPermissions(user: User, permissions: readonly Permission[]): boolean {
    return hasAllPermissionsFromList(getUserPermissions(user), permissions)
  }

  function assertPermission(user: User, permission: Permission): void {
    assertPermissionFromList(getUserPermissions(user), permission)
  }

  return {
    assertPermission,
    createSession,
    hasAllPermissions,
    hasAnyPermission,
    hasPermission,
    requestEmailVerification,
    requestPasswordReset,
    resetPassword,
    signIn,
    signOut,
    validateSession,
    verifyEmail,
  }
}
