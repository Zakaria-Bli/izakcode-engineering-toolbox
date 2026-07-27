import type { AuthInstance } from "../../core/create-auth.js"
import { ForbiddenError, UnauthorizedError } from "../../core/errors.js"
import type { AuthId, AuthSession } from "../../domain/types.js"
import {
  isSafeRequestMethod,
  readBearerToken,
  resolveCookieOptions,
  resolveTrustedOrigins,
  verifyRequestOrigin,
} from "../_shared/http.js"

export interface ExpressCookieOptions {
  domain?: string
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: "lax" | "none" | "strict"
  secure?: boolean
}

export interface ExpressLikeRequest {
  cookies?: Record<string, string | undefined>
  header(name: string): string | undefined
  method: string
}

export interface ExpressLikeResponse<User, UserId extends AuthId> {
  clearCookie(name: string, options?: ExpressCookieOptions): void
  cookie(name: string, value: string, options?: ExpressCookieOptions): void
  locals: {
    auth?: {
      session: AuthSession<UserId> | null
      tokenSource?: "bearer" | "cookie" | null
      user: User | null
    }
    session?: AuthSession<UserId> | null
    user?: User | null
  }
  set?(name: string, value: string): void
}

export type ExpressLikeNext = (error?: unknown) => void

export type ExpressLikeMiddleware<User, UserId extends AuthId> = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse<User, UserId>,
  next: ExpressLikeNext
) => void | Promise<void>

export interface CreateExpressAuthAdapterOptions<
  User,
  UserId extends AuthId,
  Permission extends string,
> {
  auth: AuthInstance<User, UserId, Permission>
  cookieName: string
  cookieOptions?: ExpressCookieOptions
  isProduction?: boolean | (() => boolean)
  sessionTtlMs?: number
  trustedOrigins?: readonly string[]
}

type SessionTokenSource = "bearer" | "cookie"

interface SessionTokenContext {
  source: SessionTokenSource | null
  token: string | null
}

/** Creates Express-like middleware/helpers for session cookies, auth context, permissions, and origin checks. */
export function createExpressAuthAdapter<User, UserId extends AuthId, Permission extends string>(
  options: CreateExpressAuthAdapterOptions<User, UserId, Permission>
) {
  const cookieOptions = resolveCookieOptions<ExpressCookieOptions>({
    cookieOptions: options.cookieOptions,
    defaultMaxAge: options.sessionTtlMs,
    isProduction: options.isProduction,
  })
  const trustedOrigins = resolveTrustedOrigins(options.trustedOrigins)

  function getSessionTokenContextFromRequest(req: ExpressLikeRequest): SessionTokenContext {
    const bearerToken = readBearerToken(req.header("authorization"))

    if (bearerToken) {
      return {
        source: "bearer",
        token: bearerToken,
      }
    }

    const cookieToken = req.cookies?.[options.cookieName]

    if (cookieToken) {
      return {
        source: "cookie",
        token: cookieToken,
      }
    }

    return {
      source: null,
      token: null,
    }
  }

  function getSessionTokenFromRequest(req: ExpressLikeRequest): string | null {
    return getSessionTokenContextFromRequest(req).token
  }

  function setSessionCookie(res: ExpressLikeResponse<User, UserId>, sessionToken: string): void {
    res.cookie(options.cookieName, sessionToken, cookieOptions)
  }

  function clearSessionCookie(res: ExpressLikeResponse<User, UserId>): void {
    res.clearCookie(options.cookieName, {
      ...cookieOptions,
      maxAge: undefined,
    })
  }

  const attachAuthContext: ExpressLikeMiddleware<User, UserId> = async (req, res, next) => {
    try {
      let { source: tokenSource, token: sessionToken } = getSessionTokenContextFromRequest(req)
      let result = await options.auth.validateSession({ sessionToken })

      if ((!result.session || !result.user) && tokenSource === "bearer") {
        const cookieToken = req.cookies?.[options.cookieName]

        if (cookieToken) {
          sessionToken = cookieToken
          tokenSource = "cookie"
          result = await options.auth.validateSession({ sessionToken })
        }
      }

      if (tokenSource === "cookie" && (!result.session || !result.user)) {
        clearSessionCookie(res)
      }

      if (
        tokenSource === "cookie" &&
        result.session &&
        result.user &&
        result.shouldRefreshCookie &&
        sessionToken
      ) {
        setSessionCookie(res, sessionToken)
      }

      res.locals.auth = {
        session: result.session,
        tokenSource: result.session && result.user ? tokenSource : null,
        user: result.user,
      }
      res.locals.session = result.session
      res.locals.user = result.user
      next()
    } catch (error) {
      next(error)
    }
  }

  const requireAuth: ExpressLikeMiddleware<User, UserId> = (_req, res, next) => {
    if (!res.locals.auth?.user || !res.locals.auth.session) {
      next(new UnauthorizedError())
      return
    }

    next()
  }

  function requirePermission(permission: Permission): ExpressLikeMiddleware<User, UserId> {
    return (_req, res, next) => {
      try {
        const authContext = res.locals.auth

        if (!authContext?.user || !authContext.session) {
          throw new UnauthorizedError()
        }

        options.auth.assertPermission(authContext.user, permission)
        next()
      } catch (error) {
        next(error)
      }
    }
  }

  const enforceRequestOrigin: ExpressLikeMiddleware<User, UserId> = async (req, res, next) => {
    try {
      if (isSafeRequestMethod(req.method)) {
        next()
        return
      }

      const bearerToken = readBearerToken(req.header("authorization"))

      if (
        bearerToken &&
        res.locals.auth?.tokenSource === "bearer" &&
        res.locals.auth.user &&
        res.locals.auth.session
      ) {
        next()
        return
      }

      if (bearerToken) {
        const bearerSession = await options.auth.validateSession({ sessionToken: bearerToken })

        if (bearerSession.user && bearerSession.session) {
          next()
          return
        }
      }

      const originHeader = req.header("origin")

      if (!originHeader) {
        next(new ForbiddenError("Origin header is required for state-changing requests."))
        return
      }

      if (!verifyRequestOrigin(originHeader, trustedOrigins)) {
        next(new ForbiddenError("Request origin is not allowed."))
        return
      }

      next()
    } catch (error) {
      next(error)
    }
  }

  return {
    attachAuthContext,
    clearSessionCookie,
    enforceRequestOrigin,
    getSessionTokenFromRequest,
    requireAuth,
    requirePermission,
    setSessionCookie,
  }
}
