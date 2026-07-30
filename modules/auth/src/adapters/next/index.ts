import type { AuthInstance } from "../../core/create-auth.js"
import { ForbiddenError, UnauthorizedError } from "../../core/errors.js"
import type { AuthId } from "../../domain/types.js"
import {
  isSafeRequestMethod,
  readBearerToken,
  resolveCookieOptions,
  resolveTrustedOrigins,
  verifyRequestOrigin,
} from "../_shared/http.js"

export interface NextCookieValue {
  value: string
}

export interface NextCookieOptions {
  domain?: string
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: "lax" | "none" | "strict"
  secure?: boolean
}

export interface NextCookieStore {
  delete(name: string): void | Promise<void>
  get(name: string): NextCookieValue | undefined
  set(name: string, value: string, options?: NextCookieOptions): void | Promise<void>
}

export interface NextHeadersLike {
  get(name: string): string | null | undefined
}

export interface CreateNextAuthAdapterOptions<
  User,
  UserId extends AuthId,
  Permission extends string,
> {
  auth: AuthInstance<User, UserId, Permission>
  cookieName: string
  cookieOptions?: NextCookieOptions
  getCookieStore(): Promise<NextCookieStore> | NextCookieStore
  isProduction?: boolean | (() => boolean)
  sessionTtlMs?: number
  trustedOrigins?: readonly string[]
}

/** Creates Next-like cookie helpers for current user lookup, auth guards, permissions, and sign-out. */
export function createNextAuthAdapter<User, UserId extends AuthId, Permission extends string>(
  options: CreateNextAuthAdapterOptions<User, UserId, Permission>
) {
  const cookieOptions = resolveCookieOptions<NextCookieOptions>({
    cookieOptions: options.cookieOptions,
    defaultMaxAge:
      options.sessionTtlMs === undefined ? undefined : Math.floor(options.sessionTtlMs / 1000),
    isProduction: options.isProduction,
  })
  const trustedOrigins = resolveTrustedOrigins(options.trustedOrigins)

  async function getCookieStore(): Promise<NextCookieStore> {
    return await options.getCookieStore()
  }

  async function getSessionToken(): Promise<string | null> {
    const cookieStore = await getCookieStore()
    return cookieStore.get(options.cookieName)?.value ?? null
  }

  async function setSessionCookie(sessionToken: string): Promise<void> {
    const cookieStore = await getCookieStore()
    await cookieStore.set(options.cookieName, sessionToken, cookieOptions)
  }

  async function clearSessionCookie(): Promise<void> {
    const cookieStore = await getCookieStore()
    await cookieStore.delete(options.cookieName)
  }

  async function getCurrentUser(): Promise<User | null> {
    const sessionToken = await getSessionToken()
    const result = await options.auth.validateSession({ sessionToken })

    if (!result.session || !result.user) {
      await clearSessionCookie()
      return null
    }

    if (result.shouldRefreshCookie && sessionToken) {
      await setSessionCookie(sessionToken)
    }

    return result.user
  }

  async function requireAuth(): Promise<User> {
    const user = await getCurrentUser()

    if (!user) {
      throw new UnauthorizedError()
    }

    return user
  }

  async function requirePermission(permission: Permission): Promise<User> {
    const user = await requireAuth()

    try {
      options.auth.assertPermission(user, permission)
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw error
      }

      throw new ForbiddenError()
    }

    return user
  }

  async function signOut(): Promise<void> {
    const sessionToken = await getSessionToken()
    await options.auth.signOut({ sessionToken })
    await clearSessionCookie()
  }

  async function enforceRequestOrigin(input: {
    headers: NextHeadersLike
    method: string
  }): Promise<void> {
    if (isSafeRequestMethod(input.method)) {
      return
    }

    const bearerToken = readBearerToken(input.headers.get("authorization"))

    if (bearerToken) {
      const bearerSession = await options.auth.validateSession({ sessionToken: bearerToken })

      if (bearerSession.user && bearerSession.session) {
        return
      }
    }

    const originHeader = input.headers.get("origin")

    if (!originHeader) {
      throw new ForbiddenError("Origin header is required for state-changing requests.")
    }

    if (!verifyRequestOrigin(originHeader, trustedOrigins)) {
      throw new ForbiddenError("Request origin is not allowed.")
    }
  }

  return {
    clearSessionCookie,
    enforceRequestOrigin,
    getCurrentUser,
    getSessionToken,
    requireAuth,
    requirePermission,
    setSessionCookie,
    signOut,
  }
}
