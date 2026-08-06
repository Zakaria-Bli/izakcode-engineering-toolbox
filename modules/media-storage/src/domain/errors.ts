export type MediaStorageErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_OBJECT_KEY"
  | "ACCESS_DENIED"
  | "UNSUPPORTED_MIME_TYPE"
  | "FILE_TOO_LARGE"
  | "UPLOAD_SESSION_NOT_FOUND"
  | "UPLOAD_SESSION_EXPIRED"
  | "UPLOAD_SESSION_INVALID_STATE"
  | "ASSET_NOT_FOUND"
  | "ASSET_IN_USE"
  | "CHECKSUM_MISMATCH"
  | "CONTENT_MISMATCH"
  | "IMAGE_PROCESSING_FAILED"
  | "STORAGE_PROVIDER_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "UPLOAD_ABORTED"
  | "CONFIGURATION_ERROR"
  | "CAPABILITY_NOT_SUPPORTED"

export interface MediaStorageErrorOptions {
  code: MediaStorageErrorCode
  message: string
  status?: number
  details?: Record<string, unknown>
  cause?: unknown
  expose?: boolean
  retryable?: boolean
}

export class MediaStorageError extends Error {
  public readonly code: MediaStorageErrorCode
  public readonly status: number
  public readonly details?: Record<string, unknown>
  public readonly expose: boolean
  public readonly retryable: boolean
  public override readonly cause?: unknown

  constructor(options: MediaStorageErrorOptions) {
    super(options.message)
    this.name = "MediaStorageError"
    this.code = options.code
    this.status = options.status ?? 500
    this.details = options.details
    this.cause = options.cause
    this.expose = options.expose ?? this.status < 500
    this.retryable = options.retryable ?? false
  }
}

export class InvalidMediaRequestError extends MediaStorageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({ code: "INVALID_REQUEST", message, status: 400, details })
    this.name = "InvalidMediaRequestError"
  }
}

export class InvalidObjectKeyError extends MediaStorageError {
  constructor(key: string, details?: Record<string, unknown>) {
    super({
      code: "INVALID_OBJECT_KEY",
      message: "Invalid media object key.",
      status: 400,
      details: { key, ...details },
    })
    this.name = "InvalidObjectKeyError"
  }
}

export class MediaAccessDeniedError extends MediaStorageError {
  constructor(message = "Media storage access denied.", details?: Record<string, unknown>) {
    super({
      code: "ACCESS_DENIED",
      message,
      status: 403,
      details,
    })
    this.name = "MediaAccessDeniedError"
  }
}

export class UnsupportedMimeTypeError extends MediaStorageError {
  constructor(mimeType: string, allowedMimeTypes: readonly string[]) {
    super({
      code: "UNSUPPORTED_MIME_TYPE",
      message: "Unsupported media MIME type.",
      status: 400,
      details: { mimeType, allowedMimeTypes: [...allowedMimeTypes] },
    })
    this.name = "UnsupportedMimeTypeError"
  }
}

export class FileTooLargeError extends MediaStorageError {
  constructor(size: number, maxSize: number) {
    super({
      code: "FILE_TOO_LARGE",
      message: "Media file is too large.",
      status: 400,
      details: { size, maxSize },
    })
    this.name = "FileTooLargeError"
  }
}

export class UploadSessionNotFoundError extends MediaStorageError {
  constructor(sessionId: string) {
    super({
      code: "UPLOAD_SESSION_NOT_FOUND",
      message: "Upload session not found.",
      status: 404,
      details: { sessionId },
    })
    this.name = "UploadSessionNotFoundError"
  }
}

export class UploadSessionExpiredError extends MediaStorageError {
  constructor(sessionId: string) {
    super({
      code: "UPLOAD_SESSION_EXPIRED",
      message: "Upload session has expired.",
      status: 410,
      details: { sessionId },
    })
    this.name = "UploadSessionExpiredError"
  }
}

export class UploadSessionStateError extends MediaStorageError {
  constructor(sessionId: string, state: string, details?: Record<string, unknown>) {
    super({
      code: "UPLOAD_SESSION_INVALID_STATE",
      message: "Upload session is not in a valid state.",
      status: 409,
      details: { sessionId, state, ...details },
    })
    this.name = "UploadSessionStateError"
  }
}

export class AssetNotFoundError extends MediaStorageError {
  constructor(assetId: string | number) {
    super({
      code: "ASSET_NOT_FOUND",
      message: "Media asset not found.",
      status: 404,
      details: { assetId },
    })
    this.name = "AssetNotFoundError"
  }
}

export class AssetInUseError extends MediaStorageError {
  constructor(assetId: string | number, details?: Record<string, unknown>) {
    super({
      code: "ASSET_IN_USE",
      message: "Media asset is still in use.",
      status: 409,
      details: { assetId, ...details },
    })
    this.name = "AssetInUseError"
  }
}

export class ChecksumMismatchError extends MediaStorageError {
  constructor(expected: string, actual: string) {
    super({
      code: "CHECKSUM_MISMATCH",
      message: "Media checksum does not match.",
      status: 400,
      details: { expected, actual },
    })
    this.name = "ChecksumMismatchError"
  }
}

export class ContentMismatchError extends MediaStorageError {
  constructor(expected: string, actual: string | null, details?: Record<string, unknown>) {
    super({
      code: "CONTENT_MISMATCH",
      message: "Uploaded media content does not match expected type.",
      status: 400,
      details: { expected, actual, ...details },
    })
    this.name = "ContentMismatchError"
  }
}

export class ImageProcessingError extends MediaStorageError {
  constructor(message: string, cause?: unknown, details?: Record<string, unknown>) {
    super({
      code: "IMAGE_PROCESSING_FAILED",
      message,
      status: 422,
      cause,
      details,
    })
    this.name = "ImageProcessingError"
  }
}

export class StorageProviderError extends MediaStorageError {
  constructor(
    provider: string,
    operation: string,
    cause?: unknown,
    details?: Record<string, unknown>
  ) {
    super({
      code: "STORAGE_PROVIDER_ERROR",
      message: `Storage provider ${provider} failed during ${operation}.`,
      status: 502,
      cause,
      details: { provider, operation, ...details },
      expose: false,
      retryable: true,
    })
    this.name = "StorageProviderError"
  }
}

export class MediaRateLimitError extends MediaStorageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "RATE_LIMIT_EXCEEDED",
      message,
      status: 429,
      details,
      retryable: true,
    })
    this.name = "MediaRateLimitError"
  }
}

export class MediaUploadAbortedError extends MediaStorageError {
  constructor(message = "Media upload completion aborted.", details?: Record<string, unknown>) {
    super({
      code: "UPLOAD_ABORTED",
      message,
      status: 499,
      details,
      expose: false,
      retryable: true,
    })
    this.name = "MediaUploadAbortedError"
  }
}

export class MediaConfigurationError extends MediaStorageError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "CONFIGURATION_ERROR",
      message,
      status: 500,
      details,
      expose: false,
    })
    this.name = "MediaConfigurationError"
  }
}

export class CapabilityNotSupportedError extends MediaStorageError {
  constructor(capability: string, details?: Record<string, unknown>) {
    super({
      code: "CAPABILITY_NOT_SUPPORTED",
      message: `Media storage capability is not supported: ${capability}.`,
      status: 501,
      details: { capability, ...details },
    })
    this.name = "CapabilityNotSupportedError"
  }
}

export function isMediaStorageError(error: unknown): error is MediaStorageError {
  return error instanceof MediaStorageError
}
