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
import type { ObjectStorageProvider } from "../../ports/storage-provider.js"
import { verifyLocalUploadSignature } from "../local/index.js"

export type NextMediaAction =
  | "createUploadIntent"
  | "completeUpload"
  | "cancelUpload"
  | "deleteAsset"
  | "moveAssets"
  | "cleanup"
  | "localPutObject"

export interface NextLikeRouteContext<
  Params extends Record<string, string> = Record<string, string>,
> {
  params?: Params | Promise<Params>
}

export interface JsonResponseInit {
  status?: number
  headers?: ConstructorParameters<typeof Headers>[0]
}

export interface NextMediaAdapterOptions<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  media: MediaStorageService<TAssetId, TActorId, TKind>
  getActorId?: (request: Request) => Promise<TActorId | null> | TActorId | null
  authorize?: (input: {
    action: NextMediaAction
    actorId: TActorId | null
    request: Request
  }) => Promise<void> | void
  parseAssetId?: (raw: string) => TAssetId
  allowUnauthenticated?: readonly NextMediaAction[]
  successResponse?: (input: { action: NextMediaAction; data: unknown; status: number }) => unknown
  errorResponse?: (input: {
    action: NextMediaAction
    error: unknown
  }) => Response | Promise<Response>
}

export interface CreateLocalPutObjectHandlerOptions<TActorId extends MediaActorId = MediaActorId> {
  storage: ObjectStorageProvider
  signingSecret: string
  getActorId?: (request: Request) => Promise<TActorId | null> | TActorId | null
  authorize?: (input: {
    action: "localPutObject"
    actorId: TActorId | null
    request: Request
  }) => Promise<void> | void
}

export interface NextMediaRouteHandlers {
  createUploadIntent(request: Request): Promise<Response>
  completeUpload(
    request: Request,
    context?: NextLikeRouteContext<{ sessionId?: string }>
  ): Promise<Response>
  cancelUpload(
    request: Request,
    context: NextLikeRouteContext<{ sessionId: string }>
  ): Promise<Response>
  deleteAsset(
    request: Request,
    context: NextLikeRouteContext<{ assetId: string }>
  ): Promise<Response>
  moveAssets(request: Request): Promise<Response>
  cleanup(request: Request): Promise<Response>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function json(data: unknown, init: JsonResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers,
  })
}

function defaultSuccessResponse(input: { data: unknown }): unknown {
  return {
    success: true,
    data: input.data,
    error: null,
  }
}

function defaultErrorResponse(input: { error: unknown }): Response {
  const error = input.error
  const status = isMediaStorageError(error) ? error.status : 500
  const code = isMediaStorageError(error) ? error.code : "INTERNAL_ERROR"
  const message = isMediaStorageError(error) && error.expose ? error.message : "Request failed."

  return json(
    {
      success: false,
      data: null,
      error: {
        code,
        message,
      },
    },
    { status }
  )
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)

  if (!isRecord(body)) {
    throw new InvalidMediaRequestError("Request body must be a JSON object.")
  }

  return body
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

async function readParams<Params extends Record<string, string>>(
  context?: NextLikeRouteContext<Params>
): Promise<Params> {
  const params = context?.params ? await context.params : null

  if (!params) {
    return {} as Params
  }

  return params
}

function readCleanupInput(body: Record<string, unknown> | null): CleanupMediaInput {
  if (!body) {
    return {}
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

async function resolveActorAndAuthorize<TActorId extends MediaActorId>(
  request: Request,
  action: NextMediaAction,
  options: Pick<
    NextMediaAdapterOptions<MediaId, TActorId, string>,
    "allowUnauthenticated" | "authorize" | "getActorId"
  >
): Promise<TActorId | null> {
  const actorId = options.getActorId ? await options.getActorId(request) : null

  if (options.authorize) {
    await options.authorize({ action, actorId, request })
    return actorId
  }

  if (!options.allowUnauthenticated?.includes(action)) {
    throw new MediaAccessDeniedError("Media action requires an authorization hook.", { action })
  }

  return actorId
}

export function createNextMediaRouteHandlers<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(options: NextMediaAdapterOptions<TAssetId, TActorId, TKind>): NextMediaRouteHandlers {
  const parseAssetId = options.parseAssetId ?? ((raw: string) => raw as TAssetId)
  const successResponse = options.successResponse ?? defaultSuccessResponse
  const errorResponse = options.errorResponse ?? defaultErrorResponse

  function send(action: NextMediaAction, status: number, data: unknown): Response {
    return json(successResponse({ action, data, status }), { status })
  }

  async function handleError(action: NextMediaAction, error: unknown): Promise<Response> {
    return await errorResponse({ action, error })
  }

  return {
    async createUploadIntent(request: Request): Promise<Response> {
      try {
        const actorId = await resolveActorAndAuthorize(request, "createUploadIntent", options)
        const body = await readJsonBody(request)
        const input: CreateUploadIntentInput<TActorId, TKind> = {
          filename: readStringField(body, "filename"),
          mimeType: readStringField(body, "mimeType"),
          size: readNumberField(body, "size"),
          kind: readStringField(body, "kind") as TKind,
          actorId,
          pathPrefix: readOptionalStringField(body, "pathPrefix"),
          metadata: readOptionalMetadata(body),
        }

        return send("createUploadIntent", 201, await options.media.createUploadIntent(input))
      } catch (error) {
        return await handleError("createUploadIntent", error)
      }
    },

    async completeUpload(
      request: Request,
      context?: NextLikeRouteContext<{ sessionId?: string }>
    ): Promise<Response> {
      try {
        const actorId = await resolveActorAndAuthorize(request, "completeUpload", options)
        const params = await readParams(context)
        const body = await readJsonBody(request)
        const sessionId = params.sessionId ?? readStringField(body, "sessionId")
        const checksum = typeof body.checksum === "string" ? body.checksum : null
        const result = await options.media.completeUpload({
          sessionId,
          actorId,
          checksum,
          signal: request.signal,
        })

        return send("completeUpload", 200, result)
      } catch (error) {
        return await handleError("completeUpload", error)
      }
    },

    async cancelUpload(
      request: Request,
      context: NextLikeRouteContext<{ sessionId: string }>
    ): Promise<Response> {
      try {
        const actorId = await resolveActorAndAuthorize(request, "cancelUpload", options)
        const params = await readParams(context)

        if (!params.sessionId) {
          throw new InvalidMediaRequestError("Missing route parameter: sessionId.")
        }

        await options.media.cancelUpload({ sessionId: params.sessionId, actorId })
        return send("cancelUpload", 200, null)
      } catch (error) {
        return await handleError("cancelUpload", error)
      }
    },

    async deleteAsset(
      request: Request,
      context: NextLikeRouteContext<{ assetId: string }>
    ): Promise<Response> {
      try {
        const actorId = await resolveActorAndAuthorize(request, "deleteAsset", options)
        const params = await readParams(context)

        if (!params.assetId) {
          throw new InvalidMediaRequestError("Missing route parameter: assetId.")
        }

        await options.media.deleteAsset({ assetId: parseAssetId(params.assetId), actorId })
        return send("deleteAsset", 200, null)
      } catch (error) {
        return await handleError("deleteAsset", error)
      }
    },

    async moveAssets(request: Request): Promise<Response> {
      try {
        const actorId = await resolveActorAndAuthorize(request, "moveAssets", options)
        const body = await readJsonBody(request)
        const rawAssetIds = body.assetIds

        if (!Array.isArray(rawAssetIds)) {
          throw new InvalidMediaRequestError("assetIds must be an array.")
        }

        const input: MoveAssetsInput<TAssetId, TActorId> = {
          assetIds: rawAssetIds.map((assetId) => parseAssetId(String(assetId))),
          toPrefix: readStringField(body, "toPrefix"),
          actorId,
        }

        return send("moveAssets", 200, await options.media.moveAssets(input))
      } catch (error) {
        return await handleError("moveAssets", error)
      }
    },

    async cleanup(request: Request): Promise<Response> {
      try {
        await resolveActorAndAuthorize(request, "cleanup", options)
        const body = await request.json().catch(() => null)
        const cleanupInput = readCleanupInput(isRecord(body) ? body : null)
        return send("cleanup", 200, await options.media.cleanup(cleanupInput))
      } catch (error) {
        return await handleError("cleanup", error)
      }
    },
  }
}

export function createNextLocalPutObjectHandler<TActorId extends MediaActorId = MediaActorId>(
  options: CreateLocalPutObjectHandlerOptions<TActorId>
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const actorId = options.getActorId ? await options.getActorId(request) : null
      await options.authorize?.({ action: "localPutObject", actorId, request })

      const url = new URL(request.url)
      const key = url.searchParams.get("key")
      const expires = Number(url.searchParams.get("expires"))
      const contentType = url.searchParams.get("contentType")
      const contentLength = Number(url.searchParams.get("contentLength"))
      const signature = url.searchParams.get("signature")

      if (
        !key ||
        !Number.isInteger(expires) ||
        !contentType ||
        !Number.isInteger(contentLength) ||
        !signature
      ) {
        throw new InvalidMediaRequestError("Missing or invalid signed upload parameters.")
      }

      const verification = verifyLocalUploadSignature({
        key,
        expires,
        contentType,
        contentLength,
        signature,
        signingSecret: options.signingSecret,
      })

      if (!verification.ok) {
        return json(
          {
            success: false,
            data: null,
            error: {
              code: "SIGNATURE_INVALID",
              reason: verification.reason,
            },
          },
          { status: verification.reason === "expired" ? 410 : 403 }
        )
      }

      const actualContentType =
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
      if (actualContentType !== contentType.toLowerCase()) {
        throw new InvalidMediaRequestError("Uploaded object type does not match signed type.", {
          expected: contentType,
          actual: actualContentType,
        })
      }

      const buffer = Buffer.from(await request.arrayBuffer())
      if (buffer.length !== contentLength) {
        throw new InvalidMediaRequestError("Uploaded object size does not match signed size.", {
          expected: contentLength,
          actual: buffer.length,
        })
      }

      await options.storage.putObject({ key, body: buffer, contentType })
      return json({ success: true, data: null, error: null })
    } catch (error) {
      return defaultErrorResponse({ error })
    }
  }
}

export const createNextMediaAdapter = createNextMediaRouteHandlers
