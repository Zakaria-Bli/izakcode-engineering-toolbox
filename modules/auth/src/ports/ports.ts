import type {
  AuthConfig,
  AuthCredentialRecord,
  AuthId,
  AuthTokenPurpose,
  PersistedAuthToken,
  PersistedSession,
} from "../domain/types.js"

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(passwordHash: string, password: string): Promise<boolean>
  verifyDummy?(password: string): Promise<void>
}

export interface TokenGenerator {
  generate(byteLength?: number): string
  hash(token: string): string
}

export interface Clock {
  now(): Date
}

export interface AuthLogger {
  debug?(message: string, context?: Record<string, unknown>): void
  error?(message: string, context?: Record<string, unknown>): void
  info?(message: string, context?: Record<string, unknown>): void
  warn?(message: string, context?: Record<string, unknown>): void
}

export interface AuthMailer<User, UserId extends AuthId> {
  sendEmailVerification(input: {
    email: string
    expiresAt: Date
    token: string
    user: User
    userId: UserId
  }): Promise<void>
  sendPasswordReset(input: {
    email: string
    expiresAt: Date
    token: string
    user: User
    userId: UserId
  }): Promise<void>
}

export type AuthPolicyDecision =
  | true
  | {
      allowed: false
      code?: string
      message?: string
    }

export interface AuthPolicies<User, UserId extends AuthId, Role, Permission extends string> {
  areUserIdsEqual?(left: UserId, right: UserId): boolean
  canRequestPasswordReset?(user: User): AuthPolicyDecision
  canSignIn?(user: User): AuthPolicyDecision
  getRolePermissions(role: Role): readonly Permission[]
  getUserEmail(user: User): string
  getUserId(user: User): UserId
  getUserPermissions?(user: User): readonly Permission[]
  getUserRole(user: User): Role
  isEmailVerified?(user: User): boolean
  validatePasswordReset?(input: { password: string }): Promise<void> | void
}

export interface UserRepository<User, UserId extends AuthId> {
  findByEmail(email: string): Promise<User | null>
  findById(id: UserId): Promise<User | null>
  markEmailVerified?(userId: UserId, verified: boolean): Promise<void>
}

export interface CredentialRepository<User, UserId extends AuthId> {
  findByEmail(email: string): Promise<AuthCredentialRecord<User> | null>
  updatePasswordHash(userId: UserId, passwordHash: string): Promise<void>
}

export interface SessionRepository<User, UserId extends AuthId> {
  create(session: PersistedSession<UserId>): Promise<PersistedSession<UserId>>
  delete(sessionId: string): Promise<void>
  deleteManyForUser?(userId: UserId): Promise<void>
  findWithUserById(
    sessionId: string
  ): Promise<{ session: PersistedSession<UserId>; user: User } | null>
  updateExpiry(sessionId: string, expiresAt: Date): Promise<void>
}

export interface ConsumeAuthTokenInput<UserId extends AuthId> {
  purpose: AuthTokenPurpose
  tokenId: string
  userId?: UserId
}

export interface AuthTokenRepository<UserId extends AuthId> {
  consume(input: ConsumeAuthTokenInput<UserId>): Promise<PersistedAuthToken<UserId> | null>
  create(token: PersistedAuthToken<UserId>): Promise<void>
  delete(tokenId: string): Promise<void>
  deleteManyForUserAndPurpose?(userId: UserId, purpose: AuthTokenPurpose): Promise<void>
}

export interface AuthRepositories<User, UserId extends AuthId> {
  credentials: CredentialRepository<User, UserId>
  sessions: SessionRepository<User, UserId>
  tokens: AuthTokenRepository<UserId>
  transaction?<Result>(work: () => Promise<Result>): Promise<Result>
  users: UserRepository<User, UserId>
}

export interface AuthPorts<User, UserId extends AuthId> {
  clock?: Clock
  logger?: AuthLogger
  mailer?: AuthMailer<User, UserId>
  passwordHasher: PasswordHasher
  tokenGenerator: TokenGenerator
}

export interface CreateAuthOptions<User, UserId extends AuthId, Role, Permission extends string> {
  config: AuthConfig
  policies: AuthPolicies<User, UserId, Role, Permission>
  ports: AuthPorts<User, UserId>
  repositories: AuthRepositories<User, UserId>
}

export function getDefaultClock(): Clock {
  return {
    now: () => new Date(),
  }
}

export function getDefaultUserIdComparator<UserId extends AuthId>(): (
  left: UserId,
  right: UserId
) => boolean {
  return (left, right) => left === right
}
