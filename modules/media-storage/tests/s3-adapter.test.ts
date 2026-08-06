import type { S3Client } from "@aws-sdk/client-s3"
import { beforeEach, describe, expect, it, vi } from "vitest"

const s3Mocks = vi.hoisted(() => ({
  createPresignedPost: vi.fn(),
  getSignedUrl: vi.fn(),
}))

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: s3Mocks.getSignedUrl,
}))

vi.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: s3Mocks.createPresignedPost,
}))

import {
  buildS3PublicUrl,
  createS3StorageProvider,
  extractS3ObjectKeyFromPublicUrl,
  isS3ObjectNotFoundError,
} from "../src/adapters/s3/index.js"

function createClient(send = vi.fn()): S3Client {
  return { send } as unknown as S3Client
}

function createProvider(send = vi.fn()) {
  return createS3StorageProvider({
    bucket: "media",
    publicUrl: "https://cdn.test/media",
    client: createClient(send),
    presignClient: createClient(),
    uploadOptions: {
      CacheControl: "max-age=60",
    },
  })
}

describe("S3StorageProvider", () => {
  beforeEach(() => {
    s3Mocks.getSignedUrl.mockReset()
    s3Mocks.getSignedUrl.mockResolvedValue("https://signed-put.test")
    s3Mocks.createPresignedPost.mockReset()
    s3Mocks.createPresignedPost.mockImplementation(async (_client, options) => ({
      url: "https://signed-post.test",
      fields: {
        key: options.Key,
        ...options.Fields,
        policy: "policy",
      },
    }))
  })

  it("signs PUT uploads with content type, content length, and upload options", async () => {
    const provider = createProvider()

    const result = await provider.createPresignedPutUrl({
      key: "uploads/file.jpg",
      contentType: "image/jpeg",
      contentLength: 123,
      expiresInSeconds: 60,
      metadata: { tenant: "acme" },
    })

    expect(result).toEqual({
      uploadUrl: "https://signed-put.test",
      headers: { "Content-Type": "image/jpeg" },
    })

    const command = s3Mocks.getSignedUrl.mock.calls[0]?.[1] as {
      input: Record<string, unknown>
    }
    expect(command.input).toMatchObject({
      Bucket: "media",
      Key: "uploads/file.jpg",
      ContentType: "image/jpeg",
      ContentLength: 123,
      Metadata: { tenant: "acme" },
      CacheControl: "max-age=60",
    })
    expect(s3Mocks.getSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn: 60 })
  })

  it("creates exact-size presigned POST upload targets", async () => {
    const provider = createS3StorageProvider({
      bucket: "media",
      publicUrl: "https://cdn.test/media",
      client: createClient(),
      presignClient: createClient(),
      uploadTargetMode: "post",
      uploadOptions: {
        ServerSideEncryption: "AES256",
      },
    })

    const result = await provider.createUploadTarget({
      key: "uploads/file.jpg",
      contentType: "image/jpeg",
      contentLength: 123,
      expiresInSeconds: 60,
      metadata: { tenant: "acme" },
    })

    expect(provider.capabilities?.exactUploadSize).toBe(true)
    expect(result.method).toBe("POST")
    expect(result.uploadUrl).toBe("https://signed-post.test")
    expect(result.headers).toEqual({})
    expect(result.fields).toMatchObject({
      key: "uploads/file.jpg",
      "Content-Type": "image/jpeg",
      "x-amz-meta-tenant": "acme",
      "x-amz-server-side-encryption": "AES256",
    })

    const options = s3Mocks.createPresignedPost.mock.calls[0]?.[1] as {
      Conditions: unknown[]
      Expires: number
      Fields: Record<string, string>
      Key: string
    }
    expect(options.Key).toBe("uploads/file.jpg")
    expect(options.Expires).toBe(60)
    expect(options.Conditions).toContainEqual(["content-length-range", 123, 123])
    expect(options.Conditions).toContainEqual(["eq", "$Content-Type", "image/jpeg"])
    expect(options.Conditions).toContainEqual({ "x-amz-meta-tenant": "acme" })
  })

  it("passes AbortSignal to S3 reads and buffers response bodies", async () => {
    const abort = new AbortController()
    const send = vi.fn(async (...args: unknown[]) => {
      void args
      return {
        Body: (async function* body() {
          yield Buffer.from("he")
          yield Buffer.from("llo")
        })(),
      }
    })
    const provider = createProvider(send)

    await expect(provider.getObjectBuffer("uploads/file.txt", abort.signal)).resolves.toEqual(
      Buffer.from("hello")
    )
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: abort.signal })
  })

  it("streams S3 response bodies with metadata", async () => {
    const abort = new AbortController()
    const send = vi.fn(async (...args: unknown[]) => {
      void args
      return {
        Body: (async function* body() {
          yield Buffer.from("stream")
        })(),
        ContentType: "text/plain",
        ContentLength: 6,
        ETag: "etag",
      }
    })
    const provider = createProvider(send)

    const result = await provider.getObjectStream({ key: "uploads/file.txt", signal: abort.signal })
    const chunks: Buffer[] = []
    for await (const chunk of result.body) {
      chunks.push(Buffer.from(chunk))
    }

    expect(Buffer.concat(chunks).toString("utf8")).toBe("stream")
    expect(result.metadata).toMatchObject({
      key: "uploads/file.txt",
      contentType: "text/plain",
      contentLength: 6,
      eTag: "etag",
    })
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: abort.signal })
  })

  it("returns null from headObject for not-found errors", async () => {
    const send = vi.fn(async () => {
      const error = new Error("missing")
      Object.assign(error, { $metadata: { httpStatusCode: 404 } })
      throw error
    })
    const provider = createProvider(send)

    await expect(provider.headObject("uploads/missing.jpg")).resolves.toBeNull()
  })

  it("chunks deleteObjects and classifies missing keys", async () => {
    const send = vi.fn(async (command: { input: { Delete: { Objects: { Key: string }[] } } }) => {
      const keys = command.input.Delete.Objects.map((entry) => entry.Key)

      if (keys.includes("key-1")) {
        return {
          Errors: [
            { Key: "key-1", Code: "NoSuchKey", Message: "missing" },
            { Key: "key-2", Code: "AccessDenied", Message: "denied" },
          ],
        }
      }

      return {}
    })
    const provider = createProvider(send)
    const keys = Array.from({ length: 1_001 }, (_, index) => `key-${index}`)

    const result = await provider.deleteObjects(keys)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]?.[0].input.Delete.Objects).toHaveLength(1_000)
    expect(send.mock.calls[1]?.[0].input.Delete.Objects).toHaveLength(1)
    expect(result.missingKeys).toEqual(["key-1"])
    expect(result.failedKeys).toEqual([
      { key: "key-2", error: { code: "AccessDenied", message: "denied" } },
    ])
    expect(result.deletedKeys).toHaveLength(999)
  })

  it("detects S3 object-not-found error shapes", () => {
    expect(
      isS3ObjectNotFoundError(Object.assign(new Error("missing"), { name: "NoSuchKey" }))
    ).toBe(true)
    expect(isS3ObjectNotFoundError({ $metadata: { httpStatusCode: 404 } })).toBe(true)
    expect(isS3ObjectNotFoundError(Object.assign(new Error("boom"), { name: "Other" }))).toBe(false)
  })

  it("encodes and parses public URLs", () => {
    expect(buildS3PublicUrl("https://cdn.test/media/", "uploads/file name.jpg")).toBe(
      "https://cdn.test/media/uploads/file%20name.jpg"
    )
    expect(
      extractS3ObjectKeyFromPublicUrl(
        "https://cdn.test/media/uploads/file%20name.jpg",
        "https://cdn.test/media"
      )
    ).toBe("uploads/file name.jpg")
  })
})
