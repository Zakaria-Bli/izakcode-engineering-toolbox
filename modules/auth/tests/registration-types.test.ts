import { describe, expect, expectTypeOf, it } from "vitest"

import type { PasswordHasher } from "../src/ports/ports.js"
import { createRegistrationService } from "../src/services/registration.js"

const passwordHasher: PasswordHasher = {
  hash: async (password) => `hash:${password}`,
  verify: async () => true,
}

function typeCheckOnly(callback: () => void): void {
  void callback
}

interface UserWithId {
  email: string
  id: string
}

interface UserWithoutId {
  email: string
  user_id: string
}

describe("registration service types", () => {
  it("requires extra when Extra has required fields", () => {
    const register = createRegistrationService<
      UserWithId,
      string,
      { displayName: string; referralCode?: string }
    >({
      createUser: async ({ email }) => ({ email, id: "user_1" }),
      passwordHasher,
    })

    expect(register).toBeTypeOf("function")
    expectTypeOf<Parameters<typeof register>[0]>().toEqualTypeOf<{
      email: string
      extra: {
        displayName: string
        referralCode?: string
      }
      password: string
    }>()

    typeCheckOnly(() => {
      // @ts-expect-error extra is required because displayName is required.
      void register({ email: "user@example.com", password: "password" })
    })
  })

  it("keeps extra optional when Extra has no required fields", () => {
    const register = createRegistrationService<UserWithId, string, { referralCode?: string }>({
      createUser: async ({ email }) => ({ email, id: "user_1" }),
      passwordHasher,
    })

    expect(register).toBeTypeOf("function")
    expectTypeOf<Parameters<typeof register>[0]>().toEqualTypeOf<{
      email: string
      extra?: {
        referralCode?: string
      }
      password: string
    }>()

    typeCheckOnly(() => {
      void register({ email: "user@example.com", password: "password" })
    })
  })

  it("omits reserved auth keys from extra", () => {
    const register = createRegistrationService<
      UserWithId,
      string,
      { displayName: string; email: string; passwordHash: string }
    >({
      createUser: async ({ email }) => ({ email, id: "user_1" }),
      passwordHasher,
    })

    expect(register).toBeTypeOf("function")
    expectTypeOf<Parameters<typeof register>[0]>().toEqualTypeOf<{
      email: string
      extra: {
        displayName: string
      }
      password: string
    }>()

    typeCheckOnly(() => {
      void register({
        email: "user@example.com",
        extra: {
          displayName: "Ada",
          // @ts-expect-error email is reserved and omitted from extra.
          email: "override@example.com",
        },
        password: "password",
      })
    })
  })

  it("requires getUserId when User does not expose id", () => {
    typeCheckOnly(() => {
      // @ts-expect-error getUserId is required for users without id.
      createRegistrationService<UserWithoutId, string>({
        createUser: async ({ email }) => ({ email, user_id: "user_1" }),
        passwordHasher,
      })
    })

    const register = createRegistrationService<UserWithoutId, string>({
      createUser: async ({ email }) => ({ email, user_id: "user_1" }),
      getUserId: (user) => user.user_id,
      passwordHasher,
    })

    expect(register).toBeTypeOf("function")
    expectTypeOf<Parameters<typeof register>[0]>().toEqualTypeOf<{
      email: string
      extra?: never
      password: string
    }>()
  })

  it("keeps getUserId optional when User exposes id", () => {
    const register = createRegistrationService<UserWithId, string>({
      createUser: async ({ email }) => ({ email, id: "user_1" }),
      passwordHasher,
    })

    expect(register).toBeTypeOf("function")
    expectTypeOf<Parameters<typeof register>[0]>().toEqualTypeOf<{
      email: string
      extra?: never
      password: string
    }>()
  })
})
