export type AuthId = number | string

export interface AuthConfig {
  dummyPasswordHash?: string
  emailVerificationTokenByteLength?: number
  emailVerificationTokenTtlMs: number
  invalidateSessionsOnPasswordReset?: boolean
  passwordResetTokenByteLength?: number
  passwordResetTokenTtlMs: number
  replaceExistingEmailVerificationTokens?: boolean
  replaceExistingPasswordResetTokens?: boolean
  sessionAbsoluteTtlMs?: number
  sessionRefreshWindowMs: number
  sessionTokenByteLength?: number
  sessionTtlMs: number
}

export interface PersistedSession<UserId extends AuthId> {
  createdAt?: Date
  expiresAt: Date
  id: string
  userId: UserId
}

export interface AuthSession<UserId extends AuthId> extends PersistedSession<UserId> {
  fresh: boolean
}

export type AuthTokenPurpose = "email_verification" | "password_reset"

export interface PersistedAuthToken<UserId extends AuthId> {
  email?: string
  expiresAt: Date
  id: string
  purpose: AuthTokenPurpose
  userId: UserId
}

export interface AuthCredentialRecord<User> {
  passwordHash: string
  user: User
}

export interface SignInInput {
  email: string
  password: string
}

export interface SignInResult<User, UserId extends AuthId> {
  session: AuthSession<UserId>
  sessionToken: string
  user: User
}

export interface ValidateSessionInput {
  sessionToken: string | null | undefined
}

export interface ValidateSessionResult<User, UserId extends AuthId> {
  session: AuthSession<UserId> | null
  shouldRefreshCookie: boolean
  user: User | null
}

export interface SignOutInput {
  sessionToken: string | null | undefined
}

export interface AuthTokenRequestResult {
  /**
   * Uniform acceptance marker for token request workflows.
   * Raw tokens are delivered only through `AuthMailer`, never in this result.
   */
  ok: true
}

export interface RequestEmailVerificationInput {
  email: string
}

export interface VerifyEmailInput<UserId extends AuthId> {
  currentUserId?: UserId | null
  token: string
}

export interface VerifyEmailResult<UserId extends AuthId> {
  userId: UserId
  verified: true
}

export interface RequestPasswordResetInput {
  email: string
}

export interface ResetPasswordInput {
  invalidateSessions?: boolean
  password: string
  token: string
}

export interface ResetPasswordResult<UserId extends AuthId> {
  passwordReset: true
  sessionsInvalidated: boolean
  userId: UserId
}
