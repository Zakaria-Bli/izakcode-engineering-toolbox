import { createNodeTokenGenerator } from "../../src/adapters/node/token-generator.js"
import { createAuth } from "../../src/core/create-auth.js"
import { InvalidCredentialsError } from "../../src/core/errors.js"
import type {
  AuthConfig,
  AuthId,
  PersistedAuthToken,
  PersistedSession,
} from "../../src/domain/types.js"
import type {
  AuthPolicies,
  AuthRepositories,
  Clock,
  PasswordHasher,
} from "../../src/ports/ports.js"

export type TestRole = "admin" | "customer"

export type TestPermission = "dashboard:read" | "profile:manage"

export interface TestUser {
  bannedAt: Date | null
  customPermissions?: TestPermission[]
  email: string
  emailVerified: boolean
  id: string
  isActive: boolean
  role: TestRole
}

export class CapturingMailer {
  public emailVerificationTokens: string[] = []
  public passwordResetTokens: string[] = []

  public async sendEmailVerification(input: {
    email: string
    expiresAt: Date
    token: string
    user: TestUser
    userId: string
  }): Promise<void> {
    void input.email
    void input.expiresAt
    void input.user
    void input.userId
    this.emailVerificationTokens.push(input.token)
  }

  public async sendPasswordReset(input: {
    email: string
    expiresAt: Date
    token: string
    user: TestUser
    userId: string
  }): Promise<void> {
    void input.email
    void input.expiresAt
    void input.user
    void input.userId
    this.passwordResetTokens.push(input.token)
  }

  public lastEmailVerificationToken(): string {
    const token = this.emailVerificationTokens.at(-1)

    if (!token) {
      throw new Error("Expected an email verification token to have been sent.")
    }

    return token
  }

  public lastPasswordResetToken(): string {
    const token = this.passwordResetTokens.at(-1)

    if (!token) {
      throw new Error("Expected a password reset token to have been sent.")
    }

    return token
  }
}

export class MutableClock implements Clock {
  private currentDate: Date

  public constructor(initialDate: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.currentDate = initialDate
  }

  public advance(ms: number): void {
    this.currentDate = new Date(this.currentDate.getTime() + ms)
  }

  public now(): Date {
    return new Date(this.currentDate)
  }
}

export class TestPasswordHasher implements PasswordHasher {
  public dummyVerifications = 0

  public async hash(password: string): Promise<string> {
    return `hash:${password}`
  }

  public async verify(passwordHash: string, password: string): Promise<boolean> {
    return passwordHash === `hash:${password}`
  }

  public async verifyDummy(password: string): Promise<void> {
    void password
    this.dummyVerifications += 1
  }
}

export class InMemoryAuthStore {
  public readonly passwordHashes = new Map<string, string>()
  public readonly sessions = new Map<string, PersistedSession<string>>()
  public readonly tokens = new Map<string, PersistedAuthToken<string>>()
  public readonly users = new Map<string, TestUser>()

  public addUser(user: TestUser, passwordHash: string): void {
    this.users.set(user.id, user)
    this.passwordHashes.set(user.id, passwordHash)
  }

  public repositories(): AuthRepositories<TestUser, string> {
    return {
      credentials: {
        findByEmail: async (email) => {
          const user = Array.from(this.users.values()).find(
            (candidate) => candidate.email === email
          )

          if (!user) {
            return null
          }

          const passwordHash = this.passwordHashes.get(user.id)

          if (!passwordHash) {
            return null
          }

          return {
            passwordHash,
            user,
          }
        },
        updatePasswordHash: async (userId, passwordHash) => {
          this.passwordHashes.set(userId, passwordHash)
        },
      },
      sessions: {
        create: async (session) => {
          this.sessions.set(session.id, session)
          return session
        },
        delete: async (sessionId) => {
          this.sessions.delete(sessionId)
        },
        deleteManyForUser: async (userId) => {
          for (const [sessionId, session] of this.sessions.entries()) {
            if (session.userId === userId) {
              this.sessions.delete(sessionId)
            }
          }
        },
        findWithUserById: async (sessionId) => {
          const session = this.sessions.get(sessionId)

          if (!session) {
            return null
          }

          const user = this.users.get(session.userId)

          if (!user) {
            return null
          }

          return {
            session,
            user,
          }
        },
        updateExpiry: async (sessionId, expiresAt) => {
          const session = this.sessions.get(sessionId)

          if (!session) {
            return
          }

          this.sessions.set(sessionId, {
            ...session,
            expiresAt,
          })
        },
      },
      tokens: {
        consume: async ({ purpose, tokenId, userId }) => {
          const token = this.tokens.get(tokenId) ?? null

          if (
            !token ||
            token.purpose !== purpose ||
            (userId !== undefined && token.userId !== userId)
          ) {
            return null
          }

          this.tokens.delete(tokenId)
          return token
        },
        create: async (token) => {
          this.tokens.set(token.id, token)
        },
        delete: async (tokenId) => {
          this.tokens.delete(tokenId)
        },
        deleteManyForUserAndPurpose: async (userId, purpose) => {
          for (const [tokenId, token] of this.tokens.entries()) {
            if (token.userId === userId && token.purpose === purpose) {
              this.tokens.delete(tokenId)
            }
          }
        },
      },
      transaction: async (work) => work(),
      users: {
        findByEmail: async (email) =>
          Array.from(this.users.values()).find((candidate) => candidate.email === email) ?? null,
        findById: async (id) => this.users.get(id) ?? null,
        markEmailVerified: async (userId, verified) => {
          const user = this.users.get(userId)

          if (user) {
            this.users.set(userId, {
              ...user,
              emailVerified: verified,
            })
          }
        },
      },
    }
  }
}

export function createTestUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    bannedAt: null,
    email: "user@example.com",
    emailVerified: false,
    id: "user_1",
    isActive: true,
    role: "customer",
    ...overrides,
  }
}

export function createTestAuthHarness(
  configOverrides: Partial<AuthConfig> = {},
  policyOverrides: Partial<AuthPolicies<TestUser, string, TestRole, TestPermission>> = {}
) {
  const clock = new MutableClock()
  const mailer = new CapturingMailer()
  const passwordHasher = new TestPasswordHasher()
  const store = new InMemoryAuthStore()
  const tokenGenerator = createNodeTokenGenerator()
  const repositories = store.repositories()

  const auth = createAuth<TestUser, string, TestRole, TestPermission>({
    config: {
      emailVerificationTokenTtlMs: 86_400_000,
      passwordResetTokenTtlMs: 3_600_000,
      sessionRefreshWindowMs: 5_000,
      sessionTtlMs: 10_000,
      ...configOverrides,
    },
    policies: {
      canRequestPasswordReset: (user) => (user.bannedAt ? { allowed: false } : true),
      canSignIn: (user) => (user.isActive && !user.bannedAt ? true : { allowed: false }),
      getRolePermissions: (role) => {
        if (role === "admin") {
          return ["dashboard:read", "profile:manage"]
        }

        return ["profile:manage"]
      },
      getUserEmail: (user) => user.email,
      getUserId: (user) => user.id,
      getUserPermissions: (user) => user.customPermissions ?? [],
      getUserRole: (user) => user.role,
      isEmailVerified: (user) => user.emailVerified,
      ...policyOverrides,
    },
    ports: {
      clock,
      mailer,
      passwordHasher,
      tokenGenerator,
    },
    repositories,
  })

  return {
    auth,
    clock,
    mailer,
    passwordHasher,
    repositories,
    store,
    tokenGenerator,
  }
}

export async function expectInvalidCredentials(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch (error: unknown) {
    if (!(error instanceof InvalidCredentialsError)) {
      throw error
    }

    return
  }

  throw new Error("Expected InvalidCredentialsError but the promise resolved successfully.")
}

export function firstMapValue<Value>(map: Map<AuthId, Value>): Value {
  const first = map.values().next()

  if (first.done) {
    throw new Error("Expected map to contain a value.")
  }

  return first.value
}
