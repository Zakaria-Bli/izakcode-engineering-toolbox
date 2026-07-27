export interface BaseCookieOptions {
  domain?: string
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: "lax" | "none" | "strict"
  secure?: boolean
}

export type IsProductionInput = boolean | (() => boolean)

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
const DEFAULT_COOKIE_OPTIONS = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
} satisfies BaseCookieOptions
const BEARER_TOKEN_PATTERN = /^bearer\s+(\S+)$/i

function readEnvironmentIsProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production"
}

export function resolveIsProduction(isProduction: IsProductionInput | undefined): boolean {
  if (typeof isProduction === "function") {
    return isProduction()
  }

  return isProduction ?? readEnvironmentIsProduction()
}

export function readBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) {
    return null
  }

  const match = authorizationHeader.trim().match(BEARER_TOKEN_PATTERN)

  return match?.[1] ?? null
}

export function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin.trim()).origin.toLowerCase()
  } catch {
    return null
  }
}

export function isSafeRequestMethod(method: string): boolean {
  return SAFE_HTTP_METHODS.has(method.toUpperCase())
}

export function assertSecureCookieOptions(
  cookieOptions: BaseCookieOptions,
  isProduction: boolean
): void {
  if (cookieOptions.sameSite === "none" && !cookieOptions.secure) {
    throw new Error("sameSite='none' session cookies must also set secure=true.")
  }

  if (isProduction && !cookieOptions.secure) {
    throw new Error("Session cookies must set secure=true in production.")
  }
}

export function resolveCookieOptions<CookieOptions extends BaseCookieOptions>(input: {
  cookieOptions?: CookieOptions
  defaultMaxAge?: number
  isProduction?: IsProductionInput
}): CookieOptions {
  const isProduction = resolveIsProduction(input.isProduction)
  const resolvedCookieOptions = {
    ...DEFAULT_COOKIE_OPTIONS,
    secure: isProduction,
    ...(input.defaultMaxAge === undefined ? {} : { maxAge: input.defaultMaxAge }),
    ...input.cookieOptions,
  } as CookieOptions

  assertSecureCookieOptions(resolvedCookieOptions, isProduction)
  return resolvedCookieOptions
}

export function resolveTrustedOrigins(trustedOrigins: readonly string[] | undefined): Set<string> {
  const normalizedOrigins: string[] = []

  for (const origin of trustedOrigins ?? []) {
    const normalizedOrigin = normalizeOrigin(origin)

    if (!normalizedOrigin) {
      throw new Error(`Invalid trusted origin: ${origin}`)
    }

    normalizedOrigins.push(normalizedOrigin)
  }

  return new Set(normalizedOrigins)
}

export function verifyRequestOrigin(
  originHeader: string,
  trustedOrigins: ReadonlySet<string>
): boolean {
  const origin = normalizeOrigin(originHeader)
  return origin !== null && trustedOrigins.has(origin)
}
