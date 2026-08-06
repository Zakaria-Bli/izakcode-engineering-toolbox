import { describe, expect, it, vi } from "vitest"

import type { MediaStorageService } from "../index.js"
import {
  createExpressMediaAdapter,
  createExpressMediaErrorMiddleware,
  type ExpressLikeNext,
  type ExpressLikeRequest,
  type ExpressLikeResponse,
} from "../src/adapters/express/index.js"
import { InvalidMediaRequestError } from "../src/domain/errors.js"

type TestMedia = MediaStorageService<number, string, string>

interface ResponseMock extends ExpressLikeResponse {
  statusCode: number
  jsonBody: unknown
}

function createMediaStub(overrides: Partial<TestMedia> = {}): TestMedia {
  return {
    createUploadIntent: async () => ({
      uploadUrl: "https://upload.test",
      headers: { "Content-Type": "image/jpeg" },
      sessionId: "session-1",
      assetId: 1,
      objectKey: "uploads/file.jpg",
      expiresAt: new Date("2026-01-01T00:05:00.000Z"),
    }),
    completeUpload: async () => ({
      asset: {} as Awaited<ReturnType<TestMedia["completeUpload"]>>["asset"],
      variants: [],
    }),
    cancelUpload: async () => undefined,
    getAsset: async () => ({
      asset: {} as Awaited<ReturnType<TestMedia["getAsset"]>>["asset"],
      variants: [],
    }),
    listAssets: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    getDownloadUrl: async () => ({
      url: "https://download.test",
      objectKey: "uploads/file.jpg",
      publicUrl: null,
      expiresAt: null,
      contentType: "image/jpeg",
    }),
    deleteAsset: async () => undefined,
    moveAssets: async () => ({ assets: [] }),
    planCleanup: async () => ({
      cutoff: new Date(0),
      items: [],
      objectKeys: [],
      assetIds: [],
      sessionIds: [],
      skippedAssetIds: [],
    }),
    cleanup: async () => ({
      plan: {
        cutoff: new Date(0),
        items: [],
        objectKeys: [],
        assetIds: [],
        sessionIds: [],
        skippedAssetIds: [],
      },
      deletedObjects: 0,
      missingObjects: 0,
      failedObjects: 0,
      deletedAssets: 0,
      expiredSessions: 0,
      skippedAssets: 0,
    }),
    ...overrides,
  }
}

function createRequest(overrides: Partial<ExpressLikeRequest> = {}): ExpressLikeRequest {
  return {
    method: "POST",
    body: {},
    params: {},
    query: {},
    header: () => undefined,
    ...overrides,
  }
}

function createResponse(): ResponseMock {
  return {
    statusCode: 200,
    jsonBody: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.jsonBody = body
    },
  }
}

describe("createExpressMediaAdapter", () => {
  it("fails closed by passing access-denied errors to next", async () => {
    const handlers = createExpressMediaAdapter({ media: createMediaStub() })
    const next = vi.fn<ExpressLikeNext>()

    await handlers.cleanup(createRequest(), createResponse(), next)

    expect(next.mock.calls[0]?.[0]).toMatchObject({ code: "ACCESS_DENIED" })
  })

  it("parses create upload intent input and sends success response", async () => {
    const createUploadIntent = vi.fn<TestMedia["createUploadIntent"]>(async (input) => ({
      uploadUrl: "https://upload.test",
      headers: { "Content-Type": input.mimeType },
      sessionId: "session-1",
      assetId: 1,
      objectKey: "uploads/file.jpg",
      expiresAt: new Date("2026-01-01T00:05:00.000Z"),
    }))
    const authorize = vi.fn()
    const handlers = createExpressMediaAdapter({
      media: createMediaStub({ createUploadIntent }),
      getActorId: () => "actor-1",
      authorize,
      parseAssetId: Number,
    })
    const res = createResponse()
    const next = vi.fn<ExpressLikeNext>()

    await handlers.createUploadIntent(
      createRequest({
        body: {
          filename: "photo.jpg",
          mimeType: "image/jpeg",
          size: 10,
          kind: "image",
          pathPrefix: "temp",
          metadata: { alt: "Photo" },
        },
      }),
      res,
      next
    )

    expect(next).not.toHaveBeenCalled()
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "createUploadIntent" })
    )
    expect(createUploadIntent).toHaveBeenCalledWith({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 10,
      kind: "image",
      actorId: "actor-1",
      pathPrefix: "temp",
      metadata: { alt: "Photo" },
    })
    expect(res.statusCode).toBe(201)
    expect(res.jsonBody).toMatchObject({ success: true, error: null })
  })

  it("parses complete, move, delete, and cleanup actions", async () => {
    const completeUpload = vi.fn<TestMedia["completeUpload"]>(async () => ({
      asset: {} as Awaited<ReturnType<TestMedia["completeUpload"]>>["asset"],
      variants: [],
    }))
    const moveAssets = vi.fn<TestMedia["moveAssets"]>(async () => ({ assets: [] }))
    const deleteAsset = vi.fn<TestMedia["deleteAsset"]>(async () => undefined)
    const cleanup = vi.fn<TestMedia["cleanup"]>(async () => ({
      plan: {
        cutoff: new Date(0),
        items: [],
        objectKeys: [],
        assetIds: [],
        sessionIds: [],
        skippedAssetIds: [],
      },
      deletedObjects: 0,
      missingObjects: 0,
      failedObjects: 0,
      deletedAssets: 0,
      expiredSessions: 0,
      skippedAssets: 0,
    }))
    const handlers = createExpressMediaAdapter({
      media: createMediaStub({ completeUpload, moveAssets, deleteAsset, cleanup }),
      getActorId: () => "actor-1",
      authorize: () => undefined,
      parseAssetId: Number,
    })
    const next = vi.fn<ExpressLikeNext>()

    await handlers.completeUpload(
      createRequest({ params: { sessionId: "session-1" }, body: { checksum: "abc" } }),
      createResponse(),
      next
    )
    await handlers.moveAssets(
      createRequest({ body: { assetIds: ["1", 2], toPrefix: "moved" } }),
      createResponse(),
      next
    )
    await handlers.deleteAsset(createRequest({ params: { assetId: "3" } }), createResponse(), next)
    await handlers.cleanup(createRequest({ body: { limit: 5 } }), createResponse(), next)

    expect(completeUpload).toHaveBeenCalledWith({
      sessionId: "session-1",
      actorId: "actor-1",
      checksum: "abc",
    })
    expect(moveAssets).toHaveBeenCalledWith({
      assetIds: [1, 2],
      toPrefix: "moved",
      actorId: "actor-1",
    })
    expect(deleteAsset).toHaveBeenCalledWith({ assetId: 3, actorId: "actor-1" })
    expect(cleanup).toHaveBeenCalledWith({ limit: 5 })
  })

  it("maps errors through error middleware safely", () => {
    const middleware = createExpressMediaErrorMiddleware()
    const mediaErrorResponse = createResponse()
    const internalErrorResponse = createResponse()

    middleware(
      new InvalidMediaRequestError("Bad media request."),
      createRequest(),
      mediaErrorResponse,
      vi.fn()
    )
    middleware(new Error("secret internals"), createRequest(), internalErrorResponse, vi.fn())

    expect(mediaErrorResponse.statusCode).toBe(400)
    expect(mediaErrorResponse.jsonBody).toMatchObject({
      success: false,
      error: { code: "INVALID_REQUEST", message: "Bad media request." },
    })
    expect(internalErrorResponse.statusCode).toBe(500)
    expect(internalErrorResponse.jsonBody).toMatchObject({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Request failed." },
    })
  })
})
