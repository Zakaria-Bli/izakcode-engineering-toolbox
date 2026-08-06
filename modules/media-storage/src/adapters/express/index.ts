import type { MediaStorageService } from "../../core/create-media-storage.js"
import {
  InvalidMediaRequestError,
  isMediaStorageError,
  MediaAccessDeniedError,
} from "../../domain/errors.js"
import type {
  CleanupMediaInput,
  CreateUploadIntentInput,
  MediaActorId,
  MediaAssetKind,
  MediaId,
  MoveAssetsInput,
} from "../../domain/types.js"

export interface ExpressLikeRequest {
  body?: unknown
  method: string
  params?: Record<string, string | undefined>
  query?: Record<string, string | string[] | undefined>
  header(name: string): string | undefined
}

export interface ExpressLikeResponse {
  locals?: Record<string, unknown>
  status(code: number): ExpressLikeResponse
  json(body: unknown): void
}

export type ExpressLikeNext = (error?: unknown) => void

export type ExpressLikeHandler = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: ExpressLikeNext
) => void | Promise<void>

export type ExpressLikeErrorHandler = (
  error: unknown,
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: ExpressLikeNext
) => void | Promise<void>

export type ExpressMediaAction =
  | "createUploadIntent"
  | "completeUpload"
  | "cancelUpload"
  | "deleteAsset"
  | "moveAssets"
  | "cleanup"

export interface ExpressMediaAdapterOptions<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  media: MediaStorageService<TAssetId, TActorId, TKind>
  getActorId?: (
    req: ExpressLikeRequest,
    res: ExpressLikeResponse
  ) => Promise<TActorId | null> | TActorId | null
  allowUnauthenticated?: readonly ExpressMediaAction[]
  authorize?: (input: {
    action: ExpressMediaAction
    actorId: TActorId | null
    req: ExpressLikeRequest
    res: ExpressLikeResponse
  }) => Promise<void> | void
  parseAssetId?: (raw: string) => TAssetId
  successResponse?: (input: {
    action: ExpressMediaAction
    data: unknown
    status: number
  }) => unknown
}

export interface ExpressMediaHandlers {
  createUploadIntent: ExpressLikeHandler
  completeUpload: ExpressLikeHandler
  cancelUpload: ExpressLikeHandler
  deleteAsset: ExpressLikeHandler
  moveAssets: ExpressLikeHandler
  cleanup: ExpressLikeHandler
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readStringField(body: Record<string, unknown>, field: string): string {
  const value = body[field]

  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidMediaRequestError(`Missing or invalid field: ${field}.`, { field })
  }

  return value
}

function readOptionalStringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field]

  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== "string") {
    throw new InvalidMediaRequestError(`Invalid field: ${field}.`, { field })
  }

  return value
}

function readOptionalMetadata(body: Record<string, unknown>): Record<string, unknown> | null {
  const value = body.metadata

  if (value === undefined || value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw new InvalidMediaRequestError("Media metadata must be an object.")
  }

  return value
}

function readNumberField(body: Record<string, unknown>, field: string): number {
  const value = body[field]

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidMediaRequestError(`Missing or invalid field: ${field}.`, { field })
  }

  return value
}

function readBody(req: ExpressLikeRequest): Record<string, unknown> {
  if (!isRecord(req.body)) {
    throw new InvalidMediaRequestError("Request body must be an object.")
  }

  return req.body
}

function readParam(req: ExpressLikeRequest, name: string): string {
  const value = req.params?.[name]

  if (!value) {
    throw new InvalidMediaRequestError(`Missing route parameter: ${name}.`, { name })
  }

  return value
}

function defaultSuccessResponse(input: { action: ExpressMediaAction; data: unknown }): unknown {
  return {
    success: true,
    data: input.data,
    error: null,
  }
}

function readCleanupInput(body: unknown): CleanupMediaInput {
  if (body === undefined || body === null) {
    return {}
  }

  if (!isRecord(body)) {
    throw new InvalidMediaRequestError("Cleanup request body must be an object.")
  }

  const limit = body.limit

  if (limit === undefined || limit === null) {
    return {}
  }

  if (typeof limit !== "number") {
    throw new InvalidMediaRequestError("Cleanup limit must be a number.", { limit })
  }

  return { limit }
}

export function createExpressMediaAdapter<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(options: ExpressMediaAdapterOptions<TAssetId, TActorId, TKind>): ExpressMediaHandlers {
  const parseAssetId = options.parseAssetId ?? ((raw: string) => raw as TAssetId)
  const successResponse = options.successResponse ?? defaultSuccessResponse

  async function resolveActorAndAuthorize(
    action: ExpressMediaAction,
    req: ExpressLikeRequest,
    res: ExpressLikeResponse
  ): Promise<TActorId | null> {
    const actorId = options.getActorId ? await options.getActorId(req, res) : null

    if (options.authorize) {
      await options.authorize({ action, actorId, req, res })
      return actorId
    }

    if (!options.allowUnauthenticated?.includes(action)) {
      throw new MediaAccessDeniedError("Media action requires an authorization hook.", { action })
    }

    return actorId
  }

  function send(
    res: ExpressLikeResponse,
    action: ExpressMediaAction,
    status: number,
    data: unknown
  ): void {
    res.status(status).json(successResponse({ action, data, status }))
  }

  const createUploadIntent: ExpressLikeHandler = async (req, res, next) => {
    try {
      const actorId = await resolveActorAndAuthorize("createUploadIntent", req, res)
      const body = readBody(req)
      const input: CreateUploadIntentInput<TActorId, TKind> = {
        filename: readStringField(body, "filename"),
        mimeType: readStringField(body, "mimeType"),
        size: readNumberField(body, "size"),
        kind: readStringField(body, "kind") as TKind,
        actorId,
        pathPrefix: readOptionalStringField(body, "pathPrefix"),
        metadata: readOptionalMetadata(body),
      }

      const result = await options.media.createUploadIntent(input)
      send(res, "createUploadIntent", 201, result)
    } catch (error) {
      next(error)
    }
  }

  const completeUpload: ExpressLikeHandler = async (req, res, next) => {
    try {
      const actorId = await resolveActorAndAuthorize("completeUpload", req, res)
      const sessionId = req.params?.sessionId ?? readStringField(readBody(req), "sessionId")
      const body = isRecord(req.body) ? req.body : {}
      const checksum = typeof body.checksum === "string" ? body.checksum : null
      const result = await options.media.completeUpload({ sessionId, actorId, checksum })
      send(res, "completeUpload", 200, result)
    } catch (error) {
      next(error)
    }
  }

  const cancelUpload: ExpressLikeHandler = async (req, res, next) => {
    try {
      const actorId = await resolveActorAndAuthorize("cancelUpload", req, res)
      await options.media.cancelUpload({ sessionId: readParam(req, "sessionId"), actorId })
      send(res, "cancelUpload", 200, null)
    } catch (error) {
      next(error)
    }
  }

  const deleteAsset: ExpressLikeHandler = async (req, res, next) => {
    try {
      const actorId = await resolveActorAndAuthorize("deleteAsset", req, res)
      await options.media.deleteAsset({ assetId: parseAssetId(readParam(req, "assetId")), actorId })
      send(res, "deleteAsset", 200, null)
    } catch (error) {
      next(error)
    }
  }

  const moveAssets: ExpressLikeHandler = async (req, res, next) => {
    try {
      const actorId = await resolveActorAndAuthorize("moveAssets", req, res)
      const body = readBody(req)
      const rawAssetIds = body.assetIds

      if (!Array.isArray(rawAssetIds)) {
        throw new InvalidMediaRequestError("assetIds must be an array.")
      }

      const input: MoveAssetsInput<TAssetId, TActorId> = {
        assetIds: rawAssetIds.map((assetId) => parseAssetId(String(assetId))),
        toPrefix: readStringField(body, "toPrefix"),
        actorId,
      }

      const result = await options.media.moveAssets(input)
      send(res, "moveAssets", 200, result)
    } catch (error) {
      next(error)
    }
  }

  const cleanup: ExpressLikeHandler = async (req, res, next) => {
    try {
      await resolveActorAndAuthorize("cleanup", req, res)
      const result = await options.media.cleanup(readCleanupInput(req.body))
      send(res, "cleanup", 200, result)
    } catch (error) {
      next(error)
    }
  }

  return {
    createUploadIntent,
    completeUpload,
    cancelUpload,
    deleteAsset,
    moveAssets,
    cleanup,
  }
}

export function createExpressMediaErrorMiddleware(): ExpressLikeErrorHandler {
  return (error, _req, res, _next) => {
    void _next
    if (isMediaStorageError(error)) {
      res.status(error.status).json({
        success: false,
        data: null,
        error: {
          code: error.code,
          message: error.expose ? error.message : "Request failed.",
        },
      })
      return
    }

    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Request failed.",
      },
    })
  }
}

export const createExpressMediaHandlers = createExpressMediaAdapter
