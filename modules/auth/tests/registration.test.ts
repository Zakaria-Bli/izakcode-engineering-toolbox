import { describe, expect, it, vi } from "vitest"

import { createRegistrationService } from "../src/services/registration.js"
import {
  createTestAuthHarness,
  createTestUser,
  type TestRole,
  type TestUser,
} from "./support/in-memory-auth.js"

describe("registration service", () => {
  it("creates a user, saves credentials, creates a session, and requests email verification", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()

    const register = createRegistrationService<TestUser, string, { role: TestRole }>({
      createSession: auth.createSession,
      createUser: async ({ email, passwordHash, role }) => {
        expect(passwordHash).toBe("hash:correct-password")
        const user = createTestUser({
          email,
          id: "registered_user",
          role,
        })
        store.users.set(user.id, user)
        return user
      },
      getUserId: (user) => user.id,
      passwordHasher,
      requestEmailVerification: auth.requestEmailVerification,
      saveCredential: async (userId, passwordHash) => {
        store.passwordHashes.set(userId, passwordHash)
      },
    })

    const result = await register({
      email: "registered@example.com",
      extra: { role: "admin" },
      password: "correct-password",
    })

    expect(result.user.email).toBe("registered@example.com")
    expect(result.user.role).toBe("admin")
    expect(result.session?.userId).toBe("registered_user")
    expect(result.sessionToken).toBeTruthy()
    expect(result.verificationTokenResult).toEqual({ ok: true })
    expect(store.passwordHashes.get("registered_user")).toBe("hash:correct-password")
    expect(store.sessions.size).toBe(1)
    expect(store.tokens.size).toBe(1)
  })

  it("rolls back the created user when credential persistence fails without a transaction", async () => {
    const { passwordHasher, store } = createTestAuthHarness()
    const failure = new Error("credential persistence failed")
    const rollbackUser = vi.fn(async ({ user }: { user: TestUser }) => {
      store.users.delete(user.id)
    })

    const register = createRegistrationService<TestUser, string>({
      createUser: async ({ email }) => {
        const user = createTestUser({ email, id: "partial_user" })
        store.users.set(user.id, user)
        return user
      },
      getUserId: (user) => user.id,
      passwordHasher,
      rollbackUser,
      saveCredential: async () => {
        throw failure
      },
    })

    await expect(
      register({
        email: "partial@example.com",
        password: "password",
      })
    ).rejects.toThrow(failure)

    expect(rollbackUser).toHaveBeenCalledOnce()
    expect(store.users.has("partial_user")).toBe(false)
  })

  it("can return verification errors without failing committed registration", async () => {
    const { passwordHasher, store } = createTestAuthHarness()
    const verificationError = new Error("mailer unavailable")
    const onVerificationError = vi.fn()

    const register = createRegistrationService<TestUser, string>({
      createUser: async ({ email }) => {
        const user = createTestUser({ email, id: "verified_later" })
        store.users.set(user.id, user)
        return user
      },
      getUserId: (user) => user.id,
      onVerificationError,
      passwordHasher,
      requestEmailVerification: async () => {
        throw verificationError
      },
      saveCredential: async (userId, passwordHash) => {
        store.passwordHashes.set(userId, passwordHash)
      },
    })

    const result = await register({
      email: "later@example.com",
      password: "password",
    })

    expect(result.user.id).toBe("verified_later")
    expect(result.verificationError).toBe(verificationError)
    expect(onVerificationError).toHaveBeenCalledOnce()
    expect(store.passwordHashes.get("verified_later")).toBe("hash:password")
  })

  it("passes registration email through to validateInput before hashing or persisting", async () => {
    const { passwordHasher } = createTestAuthHarness()
    const validationError = new Error("Password is too short.")
    const createUser = vi.fn()
    const validateInput = vi.fn(({ email, password }: { email: string; password: string }) => {
      expect(email).toBe("short@example.com")
      expect(password).toBe("123")
      throw validationError
    })

    const register = createRegistrationService<TestUser, string>({
      createUser,
      getUserId: (user) => user.id,
      passwordHasher,
      validateInput,
    })

    await expect(
      register({
        email: "short@example.com",
        password: "123",
      })
    ).rejects.toThrow(validationError)

    expect(validateInput).toHaveBeenCalledOnce()
    expect(createUser).not.toHaveBeenCalled()
  })
})
