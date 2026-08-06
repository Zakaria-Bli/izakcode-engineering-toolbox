import { describe, expect, it, vi } from "vitest"

import type { MediaStorageService, ObjectStorageProvider, PutObjectInput } from "../index.js"
import { signLocalUpload } from "../src/adapters/local/index.js"
import {
  createNextLocalPutObjectHandler,
  createNextMediaRouteHandlers,
} from "../src/adapters/next/index.js"

type TestMedia = MediaStorageService<string, string, string>

function createMediaStub(overrides: Partial<TestMedia> = {}): TestMedia {
  return {
    createUploadIntent: async () => {
      throw new Error("internal bucket secret")
    },
    completeUpload: async () => ({
      asset: {} as Awaited<ReturnType<TestMedia["completeUpload"]>>["asset"],
      variants: [],
    }),
    cancelUpload: async () => undefined,
    getAsset: async () => {
      throw new Error("not implemented")
    },
    listAssets: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    getDownloadUrl: async () => {
      throw new Error("not implemented")
    },
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

function jsonRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/media", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  })
}

describe("createNextMediaRouteHandlers", () => {
  it("fails closed when no authorization hook is configured", async () => {
    const handlers = createNextMediaRouteHandlers({ media: createMediaStub() })

    const response = await handlers.cleanup(new Request("http://localhost/api/media/cleanup"))
    const body = (await response.json()) as { error: { code: string; message: string } }

    expect(response.status).toBe(403)
    expect(body.error.code).toBe("ACCESS_DENIED")
  })

  it("does not expose unknown internal error messages", async () => {
    const handlers = createNextMediaRouteHandlers({
      media: createMediaStub(),
      allowUnauthenticated: ["createUploadIntent"],
    })

    const response = await handlers.createUploadIntent(
      jsonRequest({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 10,
        kind: "image",
      })
    )
    const body = (await response.json()) as { error: { message: string } }

    expect(response.status).toBe(500)
    expect(body.error.message).toBe("Request failed.")
  })

  it("parses create upload intent and injects actor", async () => {
    const createUploadIntent = vi.fn<TestMedia["createUploadIntent"]>(async (input) => ({
      uploadUrl: "https://upload.test",
      headers: { "Content-Type": input.mimeType },
      sessionId: "session-1",
      assetId: "asset-1",
      objectKey: "uploads/file.jpg",
      expiresAt: new Date("2026-01-01T00:05:00.000Z"),
    }))
    const authorize = vi.fn()
    const handlers = createNextMediaRouteHandlers({
      media: createMediaStub({ createUploadIntent }),
      getActorId: () => "actor-1",
      authorize,
    })

    const response = await handlers.createUploadIntent(
      jsonRequest({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 10,
        kind: "image",
        pathPrefix: "temp",
        metadata: { alt: "Photo" },
      })
    )
    const body = (await response.json()) as { success: boolean }

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
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
  })

  it("parses complete route params, checksum, and request signal", async () => {
    const completeUpload = vi.fn<TestMedia["completeUpload"]>(async () => ({
      asset: {} as Awaited<ReturnType<TestMedia["completeUpload"]>>["asset"],
      variants: [],
    }))
    const controller = new AbortController()
    const handlers = createNextMediaRouteHandlers({
      media: createMediaStub({ completeUpload }),
      getActorId: () => "actor-1",
      authorize: () => undefined,
    })

    const response = await handlers.completeUpload(
      jsonRequest({ checksum: "abc" }, controller.signal),
      {
        params: Promise.resolve({ sessionId: "session-1" }),
      }
    )

    expect(response.status).toBe(200)
    expect(completeUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        actorId: "actor-1",
        checksum: "abc",
        signal: expect.any(AbortSignal),
      })
    )
  })

  it("parses cancel, delete, move, and cleanup actions", async () => {
    const cancelUpload = vi.fn<TestMedia["cancelUpload"]>(async () => undefined)
    const deleteAsset = vi.fn<TestMedia["deleteAsset"]>(async () => undefined)
    const moveAssets = vi.fn<TestMedia["moveAssets"]>(async () => ({ assets: [] }))
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
    const handlers = createNextMediaRouteHandlers({
      media: createMediaStub({ cancelUpload, deleteAsset, moveAssets, cleanup }),
      getActorId: () => "actor-1",
      authorize: () => undefined,
      parseAssetId: (raw) => `parsed:${raw}`,
    })

    await handlers.cancelUpload(new Request("http://localhost/api/media"), {
      params: { sessionId: "session-1" },
    })
    await handlers.deleteAsset(new Request("http://localhost/api/media"), {
      params: { assetId: "asset-1" },
    })
    await handlers.moveAssets(jsonRequest({ assetIds: ["asset-1", "asset-2"], toPrefix: "moved" }))
    await handlers.cleanup(jsonRequest({ limit: 10 }))

    expect(cancelUpload).toHaveBeenCalledWith({ sessionId: "session-1", actorId: "actor-1" })
    expect(deleteAsset).toHaveBeenCalledWith({ assetId: "parsed:asset-1", actorId: "actor-1" })
    expect(moveAssets).toHaveBeenCalledWith({
      assetIds: ["parsed:asset-1", "parsed:asset-2"],
      toPrefix: "moved",
      actorId: "actor-1",
    })
    expect(cleanup).toHaveBeenCalledWith({ limit: 10 })
  })
})

describe("createNextLocalPutObjectHandler", () => {
  it("verifies signed local uploads before writing objects", async () => {
    const putObject = vi.fn(async (input: PutObjectInput) => {
      void input
    })
    const storage = { putObject } as unknown as ObjectStorageProvider
    const key = "uploads/file.txt"
    const expires = 2_000_000_000
    const contentType = "text/plain"
    const contentLength = 5
    const signingSecret = "secret"
    const signature = signLocalUpload({
      key,
      expires,
      contentType,
      contentLength,
      signingSecret,
    })
    const handler = createNextLocalPutObjectHandler({ storage, signingSecret })

    const response = await handler(
      new Request(
        `http://localhost/api/local-put?key=${encodeURIComponent(key)}&expires=${expires}&contentType=${encodeURIComponent(contentType)}&contentLength=${contentLength}&signature=${signature}`,
        {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: "hello",
        }
      )
    )

    expect(response.status).toBe(200)
    expect(putObject).toHaveBeenCalledWith({
      key,
      body: Buffer.from("hello"),
      contentType,
    })
  })

  it("rejects invalid local upload signatures", async () => {
    const putObject = vi.fn(async (input: PutObjectInput) => {
      void input
    })
    const storage = { putObject } as unknown as ObjectStorageProvider
    const handler = createNextLocalPutObjectHandler({ storage, signingSecret: "secret" })

    const response = await handler(
      new Request(
        "http://localhost/api/local-put?key=uploads/file.txt&expires=2000000000&contentType=text/plain&contentLength=5&signature=deadbeef",
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: "hello",
        }
      )
    )

    expect(response.status).toBe(403)
    expect(putObject).not.toHaveBeenCalled()
  })
})
