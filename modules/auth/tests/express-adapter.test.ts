import { describe, expect, it, vi } from "vitest"

import {
  createExpressAuthAdapter,
  type ExpressLikeResponse,
} from "../src/adapters/express/index.js"
import { ForbiddenError, UnauthorizedError } from "../src/core/errors.js"
import { createTestAuthHarness, createTestUser, type TestUser } from "./support/in-memory-auth.js"

function createRequest(
  input: {
    cookies?: Record<string, string | undefined>
    headers?: Record<string, string | undefined>
    method?: string
  } = {}
) {
  const headers = new Map(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  )

  return {
    cookies: input.cookies,
    header: (name: string) => headers.get(name.toLowerCase()),
    method: input.method ?? "GET",
  }
}

function createResponse(): ExpressLikeResponse<TestUser, string> {
  return {
    clearCookie: vi.fn(),
    cookie: vi.fn(),
    locals: {},
  }
}

describe("express auth adapter", () => {
  it("reads bearer tokens before cookie tokens", () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { httpOnly: true, path: "/" },
    })

    const token = adapter.getSessionTokenFromRequest(
      createRequest({
        cookies: { session: "cookie-token" },
        headers: { authorization: "Bearer bearer-token" },
      })
    )

    expect(token).toBe("bearer-token")
  })

  it("parses bearer tokens strictly", () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })

    // Valid forms
    expect(
      adapter.getSessionTokenFromRequest(
        createRequest({ headers: { authorization: "Bearer abc" } })
      )
    ).toBe("abc")
    expect(
      adapter.getSessionTokenFromRequest(
        createRequest({ headers: { authorization: "bearer abc" } })
      )
    ).toBe("abc")
    expect(
      adapter.getSessionTokenFromRequest(
        createRequest({ headers: { authorization: "  Bearer\tabc  " } })
      )
    ).toBe("abc")

    // Invalid forms that previously parsed loosely via split(/>\s+/, 2)
    expect(
      adapter.getSessionTokenFromRequest(
        createRequest({ headers: { authorization: "Bearer abc extra" } })
      )
    ).toBeNull()
    expect(
      adapter.getSessionTokenFromRequest(createRequest({ headers: { authorization: "Bearer " } }))
    ).toBeNull()
    expect(
      adapter.getSessionTokenFromRequest(createRequest({ headers: { authorization: "Bearer" } }))
    ).toBeNull()
    expect(
      adapter.getSessionTokenFromRequest(createRequest({ headers: { authorization: "Basic abc" } }))
    ).toBeNull()
    expect(
      adapter.getSessionTokenFromRequest(createRequest({ headers: { authorization: "abc" } }))
    ).toBeNull()
    expect(adapter.getSessionTokenFromRequest(createRequest({ headers: {} }))).toBeNull()
  })

  it("derives Express cookie maxAge from sessionTtlMs", () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      sessionTtlMs: 10_000,
    })
    const res = createResponse()

    adapter.setSessionCookie(res, "session-token")

    expect(res.cookie).toHaveBeenCalledWith("session", "session-token", {
      httpOnly: true,
      maxAge: 10_000,
      path: "/",
      sameSite: "lax",
      secure: false,
    })
  })

  it("rejects invalid trusted origins", () => {
    const { auth } = createTestAuthHarness()

    expect(() =>
      createExpressAuthAdapter({
        auth,
        cookieName: "session",
        cookieOptions: { path: "/" },
        trustedOrigins: ["not a url"],
      })
    ).toThrow("Invalid trusted origin")
  })

  it("attaches auth context and refreshes cookies", async () => {
    const { auth, clock, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    clock.advance(6_000)

    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { httpOnly: true, path: "/" },
    })
    const req = createRequest({ cookies: { session: signInResult.sessionToken } })
    const res = createResponse()
    const next = vi.fn()

    await adapter.attachAuthContext(req, res, next)

    expect(res.locals.auth?.user?.id).toBe("user_1")
    expect(res.cookie).toHaveBeenCalledWith("session", signInResult.sessionToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    })
    expect(next).toHaveBeenCalledWith()
  })

  it("clears cookies when session is missing", async () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { httpOnly: true, maxAge: 100, path: "/" },
    })
    const res = createResponse()

    await adapter.attachAuthContext(
      createRequest({ cookies: { session: "missing" } }),
      res,
      vi.fn()
    )

    expect(res.clearCookie).toHaveBeenCalledWith("session", {
      httpOnly: true,
      maxAge: undefined,
      path: "/",
      sameSite: "lax",
      secure: false,
    })
    expect(res.locals.auth?.user).toBeNull()
  })

  it("falls back to a valid cookie without clearing it when bearer auth is invalid", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const res = createResponse()

    await adapter.attachAuthContext(
      createRequest({
        cookies: { session: signInResult.sessionToken },
        headers: { authorization: "Bearer fake-token" },
      }),
      res,
      vi.fn()
    )

    expect(res.locals.auth?.user?.id).toBe("user_1")
    expect(res.locals.auth?.tokenSource).toBe("cookie")
    expect(res.clearCookie).not.toHaveBeenCalled()
  })

  it("does not convert refreshed bearer sessions into cookies", async () => {
    const { auth, clock, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    clock.advance(6_000)
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const res = createResponse()

    await adapter.attachAuthContext(
      createRequest({
        cookies: { session: "stale-cookie" },
        headers: { authorization: `Bearer ${signInResult.sessionToken}` },
      }),
      res,
      vi.fn()
    )

    expect(res.locals.auth?.tokenSource).toBe("bearer")
    expect(res.cookie).not.toHaveBeenCalled()
    expect(res.clearCookie).not.toHaveBeenCalled()
  })

  it("requires auth context", () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const next = vi.fn()

    adapter.requireAuth(createRequest(), createResponse(), next)

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(UnauthorizedError)
  })

  it("requires permissions", () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const res = createResponse()
    res.locals.auth = {
      session: {
        expiresAt: new Date("2026-01-01T00:00:10.000Z"),
        fresh: false,
        id: "session_1",
        userId: "user_1",
      },
      user: createTestUser(),
    }
    const next = vi.fn()

    adapter.requirePermission("dashboard:read")(createRequest(), res, next)

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ForbiddenError)
  })

  it("enforces request origin for state-changing cookie requests", async () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
      trustedOrigins: ["https://app.example.com"],
    })
    const next = vi.fn()

    await adapter.enforceRequestOrigin(
      createRequest({
        headers: {
          host: "app.example.com",
          origin: "https://app.example.com",
        },
        method: "POST",
      }),
      createResponse(),
      next
    )

    expect(next).toHaveBeenCalledWith()
  })

  it("rejects missing origin on state-changing cookie requests", async () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const next = vi.fn()

    await adapter.enforceRequestOrigin(createRequest({ method: "POST" }), createResponse(), next)

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ForbiddenError)
  })

  it("skips origin enforcement for validated bearer sessions", async () => {
    const { auth, passwordHasher, store } = createTestAuthHarness()
    store.addUser(createTestUser(), await passwordHasher.hash("password"))
    const signInResult = await auth.signIn({ email: "user@example.com", password: "password" })
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const next = vi.fn()

    await adapter.enforceRequestOrigin(
      createRequest({
        headers: { authorization: `Bearer ${signInResult.sessionToken}` },
        method: "POST",
      }),
      createResponse(),
      next
    )

    expect(next).toHaveBeenCalledWith()
  })

  it("does not skip origin enforcement for unvalidated bearer tokens", async () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const next = vi.fn()

    await adapter.enforceRequestOrigin(
      createRequest({ headers: { authorization: "Bearer fake-token" }, method: "POST" }),
      createResponse(),
      next
    )

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ForbiddenError)
  })

  it("does not treat invalid authorization headers as bearer-token CSRF bypasses", async () => {
    const { auth } = createTestAuthHarness()
    const adapter = createExpressAuthAdapter({
      auth,
      cookieName: "session",
      cookieOptions: { path: "/" },
    })
    const next = vi.fn()

    await adapter.enforceRequestOrigin(
      createRequest({ headers: { authorization: "Basic token" }, method: "POST" }),
      createResponse(),
      next
    )

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(ForbiddenError)
  })
})
