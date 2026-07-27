export type AuthErrorDetails = Readonly<Record<string, unknown>>

export class AuthError extends Error {
  public readonly code: string
  public readonly details?: AuthErrorDetails
  public readonly statusCode: number

  public constructor(message: string, code: string, statusCode = 400, details?: AuthErrorDetails) {
    super(message)
    this.name = "AuthError"
    this.code = code
    this.statusCode = statusCode
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ValidationError extends AuthError {
  public constructor(message = "Invalid auth input.", details?: AuthErrorDetails) {
    super(message, "auth.validation_error", 400, details)
    this.name = "ValidationError"
  }
}

export class UnauthorizedError extends AuthError {
  public constructor(message = "Authentication required.") {
    super(message, "auth.unauthorized", 401)
    this.name = "UnauthorizedError"
  }
}

export class InvalidCredentialsError extends AuthError {
  public constructor(message = "Invalid email or password.") {
    super(message, "auth.invalid_credentials", 401)
    this.name = "InvalidCredentialsError"
  }
}

export class ForbiddenError extends AuthError {
  public constructor(message = "Forbidden.", code = "auth.forbidden") {
    super(message, code, 403)
    this.name = "ForbiddenError"
  }
}

export class ConflictError extends AuthError {
  public constructor(message = "Auth resource already exists.") {
    super(message, "auth.conflict", 409)
    this.name = "ConflictError"
  }
}

export class AuthConfigurationError extends AuthError {
  public constructor(message = "Auth module is misconfigured.", details?: AuthErrorDetails) {
    super(message, "auth.misconfigured", 500, details)
    this.name = "AuthConfigurationError"
  }
}

export class InvalidTokenError extends AuthError {
  public constructor(message = "Invalid auth token.") {
    super(message, "auth.token_invalid", 401)
    this.name = "InvalidTokenError"
  }
}

export class TokenExpiredError extends AuthError {
  public constructor(message = "Auth token expired.") {
    super(message, "auth.token_expired", 401)
    this.name = "TokenExpiredError"
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}
