import { describe, expect, it, vi } from "vitest"

import {
  createNextAuthAdapter,
  type NextCookieStore,
  type NextHeadersLike,
} from "../src/adapters/next/index.js"
import { ForbiddenError, UnauthorizedError } from "../src/core/errors.js"
import { createTestAuthHarness, createTestUser } from "./support/in-memory-auth.js"

function createHeaders(headers: Record<string, string | undefined>): NextHeadersLike {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )

  return {
    get: (name: string) => normalizedHeaders.get(name.toLowerCase()),
  }
}

function createCookieStore(initialCookies: Record<string, string> = {}) {
  const cookies = new Map(Object.entries(initialCookies))
  const store: NextCookieStore = {
    delete: vi.fn((name: string) => {
      cookies.delete(name)
    }),
    get: (name: string) => {
      const value = cookies.get(name)
      return value ? { value } : undefined
    },
    set: vi.fn((name: string, value: string) => {
      cookies.set(name, value)
    }),
  }

  return {
    cookies,
    store,
  }
}

describe("next auth adapter", () => {
  it("reads, sets, and clears session cookies", async () => {
    const { auth } = createTestAuthHarness()
    const { cookies, store } = createCookieStore({ session: "initial-token" })
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { httpOnly: true, path: "/" },
      getCookieStore: () => store,
    })

    expect(await adapter.getSessionToken()).toBe("initial-token")

    await adapter.setSessionCookie("new-token")
    expect(cookies.get("session")).toBe("new-token")
    expect(store.set).toHaveBeenCalledWith("session", "new-token", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    })

    await adapter.clearSessionCookie()
    expect(cookies.has("session")).toBe(false)
    expect(store.delete).toHaveBeenCalledWith("session")
  })

  it("derives Next cookie maxAge from sessionTtlMs", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      getCookieStore: () => store,
      sessionTtlMs: 10_000,
    })

    await adapter.setSessionCookie("new-token")

    expect(store.set).toHaveBeenCalledWith("session", "new-token", {
      httpOnly: true,
      maxAge: 10,
      path: "/",
      sameSite: "lax",
      secure: false,
    })
  })

  it("rejects invalid trusted origins", () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()

    expect(() =>
      createNextAuthAdapter({
        auth,
        cookieName: "session",
        getCookieStore: () => store,
        trustedOrigins: ["not a url"],
      })
    ).toThrow("Invalid trusted origin")
  })

  it("returns current user and refreshes cookie inside refresh window", async () => {
    const { auth, clock, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    clock.advance(6_000)

    const { store: cookieStore } = createCookieStore({ session: signInResult.sessionToken })
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { httpOnly: true, path: "/" },
      getCookieStore: () => cookieStore,
    })

    const user = await adapter.getCurrentUser()

    expect(user?.id).toBe("user_1")
    expect(cookieStore.set).toHaveBeenCalledWith("session", signInResult.sessionToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    })
  })

  it("clears cookie and returns null for missing session", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore({ session: "missing" })
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      getCookieStore: () => store,
    })

    await expect(adapter.getCurrentUser()).resolves.toBeNull()
    expect(store.delete).toHaveBeenCalledWith("session")
  })

  it("requires authenticated users", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      getCookieStore: () => store,
    })

    await expect(adapter.requireAuth()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it("requires permissions", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    const { store: cookieStore } = createCookieStore({ session: signInResult.sessionToken })
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      getCookieStore: () => cookieStore,
    })

    await expect(adapter.requirePermission("dashboard:read")).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("enforces request origin for state-changing cookie requests", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      getCookieStore: () => store,
      trustedOrigins: ["https://app.example.com"],
    })

    await expect(
      adapter.enforceRequestOrigin({
        headers: createHeaders({ origin: "https://app.example.com" }),
        method: "POST",
      })
    ).resolves.toBeUndefined()
  })

  it("rejects missing origin on state-changing cookie requests", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      getCookieStore: () => store,
    })

    await expect(
      adapter.enforceRequestOrigin({
        headers: createHeaders({}),
        method: "POST",
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("does not treat invalid authorization headers as bearer-token CSRF bypasses", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      getCookieStore: () => store,
    })

    await expect(
      adapter.enforceRequestOrigin({
        headers: createHeaders({ authorization: "Basic token" }),
        method: "POST",
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("skips origin enforcement for validated bearer sessions", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    const { store: cookieStore } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      getCookieStore: () => cookieStore,
    })

    await expect(
      adapter.enforceRequestOrigin({
        headers: createHeaders({ authorization: `Bearer ${signInResult.sessionToken}` }),
        method: "POST",
      })
    ).resolves.toBeUndefined()
  })

  it("does not skip origin enforcement for unvalidated bearer tokens", async () => {
    const { auth } = createTestAuthHarness()
    const { store } = createCookieStore()
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      getCookieStore: () => store,
    })

    await expect(
      adapter.enforceRequestOrigin({
        headers: createHeaders({ authorization: "Bearer fake-token" }),
        method: "POST",
      })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("signs out by deleting persisted session and cookie", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    const { store: cookieStore } = createCookieStore({ session: signInResult.sessionToken })
    const adapter = createNextAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      getCookieStore: () => cookieStore,
    })

    await adapter.signOut()

    expect(store.sessions.size).toBe(0)
    expect(cookieStore.delete).toHaveBeenCalledWith("session")
  })
})
