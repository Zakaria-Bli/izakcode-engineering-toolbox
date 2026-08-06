import { describe, expect, it, vi } from "vitest"

import {
  assertAllowedPathPrefix,
  assertValidObjectKey,
  decodeObjectKeyFromUrlPath,
  defaultMediaStoragePolicies,
  defaultNormalizeMimeType,
  encodeObjectKeyForUrl,
  FileTooLargeError,
  InvalidMediaRequestError,
  InvalidObjectKeyError,
  MediaAssetStatus,
  MediaConfigurationError,
  type MediaUploadRecord,
  MediaUploadSessionStatus,
  normalizeFilename,
  normalizePathPrefix,
  UnsupportedMimeTypeError,
  validateCreateUploadIntentInput,
  validateImageMetadata,
  validateMediaStoragePolicies,
  validateMetadata,
  validateStoredObjectMetadata,
} from "../index.js"

function createUploadRecord(
  overrides: {
    expectedMime?: string
    expectedSize?: number
    contentType?: string
    size?: number
  } = {}
): MediaUploadRecord<string, string, string> {
  const now = new Date("2026-01-01T00:00:00.000Z")
  return {
    asset: {
      id: "asset-1",
      kind: "image",
      status: MediaAssetStatus.PENDING_UPLOAD,
      provider: "test",
      bucket: "bucket",
      objectKey: "uploads/photo.jpg",
      publicUrl: null,
      originalFilename: "photo.jpg",
      mimeType: overrides.contentType ?? overrides.expectedMime ?? "image/jpeg",
      size: overrides.size ?? overrides.expectedSize ?? 10,
      checksum: null,
      width: null,
      height: null,
      ownerId: "actor-1",
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      metadata: null,
    },
    session: {
      id: "session-1",
      assetId: "asset-1",
      expectedMime: overrides.expectedMime ?? "image/jpeg",
      expectedSize: overrides.expectedSize ?? 10,
      objectKey: "uploads/photo.jpg",
      expiresAt: now,
      status: MediaUploadSessionStatus.AWAITING,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    },
  }
}

describe("filename and MIME normalization", () => {
  it("normalizes filenames by stripping path components and control characters", () => {
    expect(normalizeFilename("../../etc/passwd.jpg")).toBe("passwd.jpg")
    expect(normalizeFilename("folder\\nested\\photo.png")).toBe("photo.png")
    expect(normalizeFilename(" \u0000bad\u007fname.jpg ")).toBe("badname.jpg")
    expect(normalizeFilename("\n\t")).toBe("upload")
    expect(normalizeFilename(`${"a".repeat(260)}.jpg`)).toHaveLength(255)
  })

  it("normalizes MIME types by trimming parameters and lowercasing", () => {
    expect(defaultNormalizeMimeType(" Image/JPEG; charset=binary ")).toBe("image/jpeg")
    expect(defaultNormalizeMimeType("   ")).toBe("")
  })
})

describe("metadata validation", () => {
  it("sanitizes metadata into JSON-safe plain data", () => {
    const metadata = validateMetadata({
      caption: "Hello",
      omitted: undefined,
      nested: { count: 1 },
    })

    expect(metadata).toEqual({ caption: "Hello", nested: { count: 1 } })
  })

  it("enforces allowed keys and calls custom validators with sanitized metadata", () => {
    const validate = vi.fn((metadata: Record<string, unknown>) => {
      if (metadata.caption !== "Hello") {
        throw new Error("unexpected metadata")
      }
    })

    expect(
      validateMetadata(
        { caption: "Hello", transient: undefined },
        { allowedKeys: ["caption", "transient"], validate }
      )
    ).toEqual({ caption: "Hello" })
    expect(validate).toHaveBeenCalledWith({ caption: "Hello" })
    expect(() =>
      validateMetadata({ caption: "Hello", extra: true }, { allowedKeys: ["caption"] })
    ).toThrow(InvalidMediaRequestError)
  })

  it("rejects non-object, circular, non-serializable, oversized, overdeep, and too-many-key metadata", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => validateMetadata([] as unknown as Record<string, unknown>)).toThrow(
      InvalidMediaRequestError
    )
    expect(() => validateMetadata(circular)).toThrow(InvalidMediaRequestError)
    expect(() => validateMetadata({ bad: BigInt(1) })).toThrow(InvalidMediaRequestError)
    expect(() => validateMetadata({ text: "123456" }, { maxBytes: 10 })).toThrow(
      InvalidMediaRequestError
    )
    expect(() => validateMetadata({ a: { b: { c: true } } }, { maxDepth: 2 })).toThrow(
      InvalidMediaRequestError
    )
    expect(() => validateMetadata({ a: 1, b: { c: 2 } }, { maxKeys: 2 })).toThrow(
      InvalidMediaRequestError
    )
  })

  it("rejects prototype pollution metadata keys at any depth", () => {
    expect(() =>
      validateMetadata(
        JSON.parse('{"safe":true,"nested":{"__proto__":{"polluted":true}}}') as Record<
          string,
          unknown
        >
      )
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateMetadata(
        JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') as Record<string, unknown>
      )
    ).toThrow(InvalidMediaRequestError)
  })
})

describe("path prefix and object key validation", () => {
  it("normalizes and validates allowed upload path prefixes", () => {
    expect(normalizePathPrefix(" /tenant/uploads/ ")).toBe("tenant/uploads")
    expect(normalizePathPrefix(" / ")).toBeNull()
    expect(() =>
      assertAllowedPathPrefix("tenant/uploads", {
        ...defaultMediaStoragePolicies,
        pathPrefixes: { allowedPrefixes: ["tenant/uploads"] },
      })
    ).not.toThrow()
    expect(() =>
      assertAllowedPathPrefix("tenant/other", {
        ...defaultMediaStoragePolicies,
        pathPrefixes: { allowedPrefixes: ["tenant/uploads"] },
      })
    ).toThrow(InvalidMediaRequestError)
    expect(() => assertAllowedPathPrefix("tenant/../uploads", defaultMediaStoragePolicies)).toThrow(
      InvalidMediaRequestError
    )
    expect(() => assertAllowedPathPrefix("tenant//uploads", defaultMediaStoragePolicies)).toThrow(
      InvalidMediaRequestError
    )
    expect(() => assertAllowedPathPrefix("tenant\\uploads", defaultMediaStoragePolicies)).toThrow(
      InvalidMediaRequestError
    )
  })

  it("rejects malformed object keys", () => {
    for (const key of [
      "",
      "/uploads/photo.jpg",
      "uploads/photo.jpg/",
      "uploads//photo.jpg",
      "uploads/./photo.jpg",
      "uploads/../photo.jpg",
      "uploads\\photo.jpg",
      `media/${"a".repeat(1_030)}`,
    ]) {
      expect(() => assertValidObjectKey(key), key).toThrow(InvalidObjectKeyError)
    }
  })

  it("encodes and decodes object key URL paths safely", () => {
    const encoded = encodeObjectKeyForUrl("uploads/a b/photo#1.jpg")

    expect(encoded).toBe("uploads/a%20b/photo%231.jpg")
    expect(decodeObjectKeyFromUrlPath(encoded)).toBe("uploads/a b/photo#1.jpg")
    expect(() => decodeObjectKeyFromUrlPath("uploads/%2E%2E/photo.jpg")).toThrow(
      InvalidObjectKeyError
    )
  })
})

describe("upload intent validation", () => {
  it("validates and normalizes upload intent input", () => {
    const input = validateCreateUploadIntentInput(
      {
        filename: " folder/photo.jpg ",
        mimeType: " Image/JPEG; charset=binary ",
        size: 10,
        kind: "image",
        actorId: undefined,
        pathPrefix: " /temp/ ",
        metadata: { caption: "Photo" },
      },
      {
        ...defaultMediaStoragePolicies,
        allowedMimeTypesByKind: { image: ["image/jpeg"] },
        maxSizeByKind: { image: 10 },
        pathPrefixes: { allowedPrefixes: ["temp"] },
      }
    )

    expect(input).toMatchObject({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 10,
      kind: "image",
      actorId: null,
      pathPrefix: "temp",
      metadata: { caption: "Photo" },
    })
  })

  it("rejects invalid upload intent kind, size, MIME, max-size, path, and metadata", () => {
    const policies = {
      ...defaultMediaStoragePolicies,
      allowedMimeTypesByKind: { image: ["image/jpeg"] },
      maxSizeByKind: { image: 10 },
      pathPrefixes: { allowedPrefixes: ["temp"] },
      metadata: { allowedKeys: ["caption"] },
    }

    expect(() =>
      validateCreateUploadIntentInput(
        { filename: "x.jpg", mimeType: "image/jpeg", size: 1, kind: "" },
        policies
      )
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateCreateUploadIntentInput(
        { filename: "x.jpg", mimeType: "image/jpeg", size: 0, kind: "image" },
        policies
      )
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateCreateUploadIntentInput(
        { filename: "x.jpg", mimeType: "", size: 1, kind: "image" },
        policies
      )
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateCreateUploadIntentInput(
        { filename: "x.png", mimeType: "image/png", size: 1, kind: "image" },
        policies
      )
    ).toThrow(UnsupportedMimeTypeError)
    expect(() =>
      validateCreateUploadIntentInput(
        { filename: "x.jpg", mimeType: "image/jpeg", size: 11, kind: "image" },
        policies
      )
    ).toThrow(FileTooLargeError)
    expect(() =>
      validateCreateUploadIntentInput(
        {
          filename: "x.jpg",
          mimeType: "image/jpeg",
          size: 1,
          kind: "image",
          pathPrefix: "blocked",
        },
        policies
      )
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateCreateUploadIntentInput(
        {
          filename: "x.jpg",
          mimeType: "image/jpeg",
          size: 1,
          kind: "image",
          metadata: { extra: true },
        },
        policies
      )
    ).toThrow(InvalidMediaRequestError)
  })
})

describe("stored object and image validation", () => {
  it("accepts matching stored object metadata after MIME normalization", () => {
    expect(() =>
      validateStoredObjectMetadata(createUploadRecord(), {
        contentType: " IMAGE/JPEG; charset=binary ",
        contentLength: 10,
      })
    ).not.toThrow()
  })

  it("rejects missing, wrong-type, and wrong-size stored object metadata", () => {
    expect(() => validateStoredObjectMetadata(createUploadRecord(), null)).toThrow(
      InvalidMediaRequestError
    )
    expect(() =>
      validateStoredObjectMetadata(createUploadRecord(), {
        contentType: "image/png",
        contentLength: 10,
      })
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateStoredObjectMetadata(createUploadRecord(), {
        contentType: "image/jpeg",
        contentLength: 9,
      })
    ).toThrow(InvalidMediaRequestError)
  })

  it("enforces image dimension limits", () => {
    expect(() =>
      validateImageMetadata(
        { width: 100, height: 100, format: "jpeg", size: 10 },
        {
          minWidth: 100,
          minHeight: 100,
          maxWidth: 200,
          maxHeight: 200,
        }
      )
    ).not.toThrow()
    expect(() =>
      validateImageMetadata({ width: 99, height: 100, format: "jpeg", size: 10 }, { minWidth: 100 })
    ).toThrow(InvalidMediaRequestError)
    expect(() =>
      validateImageMetadata(
        { width: 201, height: 100, format: "jpeg", size: 10 },
        { maxWidth: 200 }
      )
    ).toThrow(InvalidMediaRequestError)
  })
})

describe("policy configuration validation", () => {
  it("accepts default production policy shape", () => {
    expect(() => validateMediaStoragePolicies(defaultMediaStoragePolicies)).not.toThrow()
  })

  it("rejects invalid numeric policy values, variants, and metadata limits", () => {
    expect(() =>
      validateMediaStoragePolicies({ ...defaultMediaStoragePolicies, uploadSessionTtlMs: 0 })
    ).toThrow(MediaConfigurationError)
    expect(() =>
      validateMediaStoragePolicies({ ...defaultMediaStoragePolicies, maxSizeByKind: { image: 0 } })
    ).toThrow(MediaConfigurationError)
    expect(() =>
      validateMediaStoragePolicies({
        ...defaultMediaStoragePolicies,
        variants: [{ name: " ", width: 100, quality: 80, format: "webp" }],
      })
    ).toThrow(MediaConfigurationError)
    expect(() =>
      validateMediaStoragePolicies({
        ...defaultMediaStoragePolicies,
        variants: [{ name: "thumb", width: 0, quality: 80, format: "webp" }],
      })
    ).toThrow(MediaConfigurationError)
    expect(() =>
      validateMediaStoragePolicies({
        ...defaultMediaStoragePolicies,
        variants: [{ name: "thumb", width: 100, height: 0, quality: 80, format: "webp" }],
      })
    ).toThrow(MediaConfigurationError)
    expect(() =>
      validateMediaStoragePolicies({
        ...defaultMediaStoragePolicies,
        variants: [{ name: "thumb", width: 100, quality: 101, format: "webp" }],
      })
    ).toThrow(MediaConfigurationError)
    expect(() =>
      validateMediaStoragePolicies({ ...defaultMediaStoragePolicies, metadata: { maxBytes: 0 } })
    ).toThrow(MediaConfigurationError)
  })
})
