import { describe, expect, it, vi } from "vitest"

import {
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTokenError,
  TokenExpiredError,
  ValidationError,
} from "../src/core/errors.js"
import {
  createTestAuthHarness,
  createTestUser,
  expectInvalidCredentials,
  firstMapValue,
} from "./support/in-memory-auth.js"

describe("auth core", () => {
  it("rejects unsafe auth config", () => {
    expect(() => createTestAuthHarness({ sessionTokenByteLength: 16 })).toThrow(ValidationError)
    expect(() =>
      createTestAuthHarness({
        sessionRefreshWindowMs: 10_000,
        sessionTtlMs: 10_000,
      })
    ).toThrow(ValidationError)
  })

  it("signs in with valid credentials and stores a hashed session token", async () => {
    const { auth, passwordHasher, store, tokenGenerator } = createTestAuthHarness()
    const user = createTestUser()
    store.addUser(user, await passwordHasher.hash("correct-password"))

    const result = await auth.signIn({
      email: "user@example.com",
      password: "correct-password",
    })

    expect(result.user).toEqual(user)
    expect(result.session.userId).toBe(user.id)
    expect(result.sessionToken).not.toBe(result.session.id)
    expect(store.sessions.has(tokenGenerator.hash(result.sessionToken))).toBe(true)
  })

  it("runs dummy password verification for missing emails", async () => {
    const { auth, passwordHasher } = createTestAuthHarness()

    await expectInvalidCredentials(
      auth.signIn({
        email: "missing@example.com",
        password: "wrong-password",
      })
    )

    expect(passwordHasher.dummyVerifications).toBe(1)
  })

  it("rejects invalid passwords", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("correct-password"))

    await expect(
      auth.signIn({
        email: "user@example.com",
        password: "wrong-password",
      })
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it("rejects inactive users through policy", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser({ isActive: false }), await passwordHasher.hash("password"))

    await expect(
      auth.signIn({
        email: "user@example.com",
        password: "password",
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("does not leak inactive account state when the password is wrong", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser({ isActive: false }), await passwordHasher.hash("password"))

    await expect(
      auth.signIn({
        email: "user@example.com",
        password: "wrong-password",
      })
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it("validates and refreshes sessions inside the refresh window", async () => {
    const { auth, clock, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))

    const signInResult = await auth.signIn({
      email: "user@example.com",
      password: "password",
    })
    const oldExpiresAt = signInResult.session.expiresAt

    clock.advance(6_000)

    const validation = await auth.validateSession({ sessionToken: signInResult.sessionToken })

    expect(validation.user?.id).toBe("user_1")
    expect(validation.session?.fresh).toBe(true)
    expect(validation.shouldRefreshCookie).toBe(true)
    expect(validation.session?.expiresAt.getTime()).toBeGreaterThan(oldExpiresAt.getTime())
  })

  it("deletes expired sessions", async () => {
    const { auth, clock, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))

    const signInResult = await auth.signIn({
      email: "user@example.com",
      password: "password",
    })

    clock.advance(10_001)

    const validation = await auth.validateSession({ sessionToken: signInResult.sessionToken })

    expect(validation.user).toBeNull()
    expect(validation.session).toBeNull()
    expect(store.sessions.size).toBe(0)
  })

  it("caps sliding session refresh at the absolute session lifetime", async () => {
    const { auth, clock, passwordHasher, store } = createTestAuthHarness({
      sessionAbsoluteTtlMs: 12_000,
    })
    store.addUser(createTestUser(), await passwordHasher.hash("password"))

    const signInResult = await auth.signIn({
      email: "user@example.com",
      password: "password",
    })

    clock.advance(6_000)

    const refreshed = await auth.validateSession({ sessionToken: signInResult.sessionToken })

    expect(refreshed.session?.expiresAt.toISOString()).toBe("2026-01-01T00:00:12.000Z")

    clock.advance(6_001)

    const expired = await auth.validateSession({ sessionToken: signInResult.sessionToken })

    expect(expired.session).toBeNull()
    expect(expired.user).toBeNull()
  })

  it("propagates unexpected session policy errors", async () => {
    const policyError = new Error("policy exploded")
    const { auth, passwordHasher, store } = createTestAuthHarness(
      {},
      {
        canSignIn: (user) => {
          if (store.sessions.size > 0) {
            throw policyError
          }

          return user.isActive ? true : { allowed: false }
        },
      }
    )
    store.addUser(createTestUser(), await passwordHasher.hash("password"))

    const signInResult = await auth.signIn({
      email: "user@example.com",
      password: "password",
    })

    await expect(auth.validateSession({ sessionToken: signInResult.sessionToken })).rejects.toThrow(
      policyError
    )
    expect(store.sessions.size).toBe(1)
  })

  it("signs out by deleting the persisted session", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))

    const signInResult = await auth.signIn({
      email: "user@example.com",
      password: "password",
    })

    await auth.signOut({ sessionToken: signInResult.sessionToken })

    expect(store.sessions.size).toBe(0)
  })

  it("checks role and user permissions", () => {
    const { auth } = createTestAuthHarness()
    const customer = createTestUser()
    const admin = createTestUser({ role: "admin" })
    const promotedCustomer = createTestUser({ customPermissions: ["dashboard:read"] })

    expect(auth.hasPermission(customer, "profile:manage")).toBe(true)
    expect(auth.hasPermission(customer, "dashboard:read")).toBe(false)
    expect(auth.hasPermission(admin, "dashboard:read")).toBe(true)
    expect(auth.hasPermission(promotedCustomer, "dashboard:read")).toBe(true)
    expect(auth.hasAllPermissions(admin, ["dashboard:read", "profile:manage"])).toBe(true)
    expect(auth.hasAnyPermission(customer, ["dashboard:read", "profile:manage"])).toBe(true)
  })

  it("requests and verifies email with a hashed token", async () => {
    const { auth, mailer, store, tokenGenerator } = createTestAuthHarness()
    const user = createTestUser({ emailVerified: false })
    store.addUser(user, "hash:password")

    const request = await auth.requestEmailVerification({ email: "user@example.com" })
    const token = mailer.lastEmailVerificationToken()

    expect(request).toEqual({ ok: true })
    expect(store.tokens.has(tokenGenerator.hash(token))).toBe(true)

    const result = await auth.verifyEmail({ token })

    expect(result.verified).toBe(true)
    expect(store.users.get(user.id)?.emailVerified).toBe(true)
    expect(store.tokens.size).toBe(0)
    await expect(auth.verifyEmail({ token })).rejects.toBeInstanceOf(InvalidTokenError)
  })

  it("rejects email verification tokens after the user email changes", async () => {
    const { auth, mailer, store } = createTestAuthHarness()
    const user = createTestUser({ email: "old@example.com", emailVerified: false })
    store.addUser(user, "hash:password")

    await auth.requestEmailVerification({ email: "old@example.com" })
    const token = mailer.lastEmailVerificationToken()
    store.users.set(user.id, {
      ...user,
      email: "new@example.com",
    })

    await expect(auth.verifyEmail({ token })).rejects.toBeInstanceOf(InvalidTokenError)
    expect(store.tokens.size).toBe(0)
    expect(store.users.get(user.id)?.emailVerified).toBe(false)
  })

  it("revalidates atomically consumed token purpose", async () => {
    const { auth, mailer, repositories, store, tokenGenerator } = createTestAuthHarness()
    const user = createTestUser({ emailVerified: false })
    store.addUser(user, "hash:password")

    await auth.requestEmailVerification({ email: "user@example.com" })
    const token = mailer.lastEmailVerificationToken()
    repositories.tokens.consume = vi.fn(async () => ({
      expiresAt: new Date("2026-01-01T00:01:00.000Z"),
      id: tokenGenerator.hash(token),
      purpose: "password_reset" as const,
      userId: user.id,
    }))

    await expect(auth.verifyEmail({ token })).rejects.toBeInstanceOf(InvalidTokenError)
    expect(store.users.get(user.id)?.emailVerified).toBe(false)
  })

  it("does not consume email verification tokens for the wrong current user", async () => {
    const { auth, mailer, store } = createTestAuthHarness()
    store.addUser(createTestUser({ emailVerified: false }), "hash:password")

    await auth.requestEmailVerification({ email: "user@example.com" })
    const token = mailer.lastEmailVerificationToken()

    await expect(auth.verifyEmail({ currentUserId: "other_user", token })).rejects.toBeInstanceOf(
      InvalidTokenError
    )
    expect(store.tokens.size).toBe(1)
    await expect(auth.verifyEmail({ token })).resolves.toMatchObject({
      verified: true,
    })
  })

  it("does not consume tokens for the wrong purpose", async () => {
    const { auth, mailer, store } = createTestAuthHarness()
    store.addUser(createTestUser({ emailVerified: false }), "hash:old-password")

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()

    await expect(auth.verifyEmail({ token })).rejects.toBeInstanceOf(InvalidTokenError)
    expect(store.tokens.size).toBe(1)
    await expect(auth.resetPassword({ password: "new-password", token })).resolves.toMatchObject({
      passwordReset: true,
    })
  })

  it("can replace existing email verification tokens for the same user", async () => {
    const { auth, mailer, store } = createTestAuthHarness({
      replaceExistingEmailVerificationTokens: true,
    })
    store.addUser(createTestUser({ emailVerified: false }), "hash:password")

    await auth.requestEmailVerification({ email: "user@example.com" })
    const firstToken = mailer.lastEmailVerificationToken()
    await auth.requestEmailVerification({ email: "user@example.com" })
    const secondToken = mailer.lastEmailVerificationToken()

    expect(store.tokens.size).toBe(1)
    await expect(auth.verifyEmail({ token: firstToken })).rejects.toBeInstanceOf(InvalidTokenError)
    await expect(auth.verifyEmail({ token: secondToken })).resolves.toMatchObject({
      verified: true,
    })
  })

  it("expires email verification tokens", async () => {
    const { auth, clock, mailer, store } = createTestAuthHarness()
    store.addUser(createTestUser({ emailVerified: false }), "hash:password")

    await auth.requestEmailVerification({ email: "user@example.com" })
    const token = mailer.lastEmailVerificationToken()
    clock.advance(86_400_001)

    await expect(auth.verifyEmail({ token })).rejects.toBeInstanceOf(TokenExpiredError)
    expect(store.tokens.size).toBe(0)
  })

  it("returns a uniform ok result for missing email verification users", async () => {
    const { auth, mailer } = createTestAuthHarness()

    const request = await auth.requestEmailVerification({ email: "missing@example.com" })

    expect(request).toEqual({ ok: true })
    expect(mailer.emailVerificationTokens).toHaveLength(0)
  })

  it("returns ok and deletes the token when password reset delivery fails", async () => {
    const { auth, mailer, store } = createTestAuthHarness()
    store.addUser(createTestUser(), "hash:password")
    vi.spyOn(mailer, "sendPasswordReset").mockRejectedValueOnce(new Error("mailer down"))

    const request = await auth.requestPasswordReset({ email: "user@example.com" })

    expect(request).toEqual({ ok: true })
    expect(store.tokens.size).toBe(0)
  })

  it("requests and completes password reset with hashed tokens", async () => {
    const { auth, mailer, passwordHasher, store, tokenGenerator } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("old-password"))
    const signInResult = await auth.signIn({
      email: "user@example.com",
      password: "old-password",
    })

    const request = await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()

    expect(request).toEqual({ ok: true })
    expect(store.tokens.has(tokenGenerator.hash(token))).toBe(true)

    const result = await auth.resetPassword({
      password: "new-password",
      token,
    })

    expect(result.passwordReset).toBe(true)
    expect(result.sessionsInvalidated).toBe(true)
    expect(store.sessions.size).toBe(0)
    expect(firstMapValue(store.passwordHashes)).toBe("hash:new-password")
    await expectInvalidCredentials(
      auth.signIn({
        email: "user@example.com",
        password: "old-password",
      })
    )
    await expect(
      auth.signIn({
        email: "user@example.com",
        password: "new-password",
      })
    ).resolves.toMatchObject({ user: { id: "user_1" } })
    await expect(auth.resetPassword({ password: "another", token })).rejects.toBeInstanceOf(
      InvalidTokenError
    )
    expect(signInResult.sessionToken).toBeTruthy()
  })

  it("runs password reset mutations inside repository transaction when available", async () => {
    const { auth, mailer, repositories, store } = createTestAuthHarness()
    repositories.transaction = vi.fn(async (work) => work())
    store.addUser(createTestUser(), "hash:old-password")

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()
    vi.mocked(repositories.transaction).mockClear()

    await expect(auth.resetPassword({ password: "new-password", token })).resolves.toMatchObject({
      passwordReset: true,
    })
    expect(repositories.transaction).toHaveBeenCalledOnce()
  })

  it("can replace existing password reset tokens for the same user", async () => {
    const { auth, mailer, store } = createTestAuthHarness({
      replaceExistingPasswordResetTokens: true,
    })
    store.addUser(createTestUser(), "hash:old-password")

    await auth.requestPasswordReset({ email: "user@example.com" })
    const firstToken = mailer.lastPasswordResetToken()
    await auth.requestPasswordReset({ email: "user@example.com" })
    const secondToken = mailer.lastPasswordResetToken()

    expect(store.tokens.size).toBe(1)
    await expect(
      auth.resetPassword({ password: "new-password", token: firstToken })
    ).rejects.toBeInstanceOf(InvalidTokenError)
    await expect(
      auth.resetPassword({ password: "new-password", token: secondToken })
    ).resolves.toMatchObject({ passwordReset: true })
  })

  it("requires token replacement repository support when replacement is enabled", async () => {
    const { auth, repositories, store } = createTestAuthHarness({
      replaceExistingPasswordResetTokens: true,
    })
    store.addUser(createTestUser(), "hash:password")
    repositories.tokens.deleteManyForUserAndPurpose = undefined

    await expect(auth.requestPasswordReset({ email: "user@example.com" })).rejects.toThrow(
      "Token replacement requires tokens.deleteManyForUserAndPurpose repository support."
    )
    expect(store.tokens.size).toBe(0)
  })

  it("requires deleteManyForUser when password reset session invalidation is enabled", async () => {
    const { auth, mailer, repositories, store } = createTestAuthHarness()
    store.addUser(createTestUser(), "hash:password")
    repositories.sessions.deleteManyForUser = undefined

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()

    await expect(auth.resetPassword({ password: "new-password", token })).rejects.toThrow(
      "Password reset session invalidation requires sessions.deleteManyForUser repository support."
    )
    expect(firstMapValue(store.passwordHashes)).toBe("hash:password")
  })

  it("requires a repository transaction for password reset by default", async () => {
    const { auth, mailer, repositories, store } = createTestAuthHarness()
    store.addUser(createTestUser(), "hash:password")

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()
    repositories.transaction = undefined

    await expect(auth.resetPassword({ password: "new-password", token })).rejects.toThrow(
      "Password reset requires repositories.transaction"
    )
    expect(firstMapValue(store.passwordHashes)).toBe("hash:password")
  })

  it("can reset password without session invalidation when requested", async () => {
    const { auth, mailer, repositories, store } = createTestAuthHarness()
    store.addUser(createTestUser(), "hash:password")
    repositories.sessions.deleteManyForUser = undefined

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()
    const result = await auth.resetPassword({
      invalidateSessions: false,
      password: "new-password",
      token,
    })

    expect(result.sessionsInvalidated).toBe(false)
    expect(firstMapValue(store.passwordHashes)).toBe("hash:new-password")
  })

  it("validates password reset passwords before consuming tokens", async () => {
    const { auth, mailer, store } = createTestAuthHarness(
      {},
      {
        validatePasswordReset: ({ password }) => {
          if (password.length < 12) {
            throw new ValidationError("Password is too short.")
          }
        },
      }
    )
    store.addUser(createTestUser(), "hash:old-password")

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()

    await expect(auth.resetPassword({ password: "short", token })).rejects.toBeInstanceOf(
      ValidationError
    )
    expect(store.tokens.size).toBe(1)
    expect(firstMapValue(store.passwordHashes)).toBe("hash:old-password")
  })

  it("expires password reset tokens", async () => {
    const { auth, clock, mailer, store } = createTestAuthHarness()
    store.addUser(createTestUser(), "hash:password")

    await auth.requestPasswordReset({ email: "user@example.com" })
    const token = mailer.lastPasswordResetToken()
    clock.advance(3_600_001)

    await expect(
      auth.resetPassword({
        password: "new-password",
        token,
      })
    ).rejects.toBeInstanceOf(TokenExpiredError)
    expect(store.tokens.size).toBe(0)
  })

  it("returns a uniform ok result for missing password reset users", async () => {
    const { auth, mailer } = createTestAuthHarness()

    const request = await auth.requestPasswordReset({ email: "missing@example.com" })

    expect(request).toEqual({ ok: true })
    expect(mailer.passwordResetTokens).toHaveLength(0)
  })

  it("returns a uniform ok result when password reset policy denies the user", async () => {
    const { auth, mailer, store } = createTestAuthHarness()
    store.addUser(
      createTestUser({ bannedAt: new Date("2026-01-01T00:00:00.000Z") }),
      "hash:password"
    )

    const request = await auth.requestPasswordReset({ email: "user@example.com" })

    expect(request).toEqual({ ok: true })
    expect(mailer.passwordResetTokens).toHaveLength(0)
    expect(store.tokens.size).toBe(0)
  })
})
