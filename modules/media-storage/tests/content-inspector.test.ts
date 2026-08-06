import { describe, expect, it } from "vitest"

import {
  createBasicContentInspector,
  detectMimeTypeFromMagicBytes,
} from "../src/adapters/content-inspector/index.js"

describe("BasicContentInspector", () => {
  it("detects common image and PDF magic bytes", () => {
    expect(detectMimeTypeFromMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg")
    expect(detectMimeTypeFromMagicBytes(Buffer.from("%PDF-1.7"))).toBe("application/pdf")
  })

  it("accepts matching detected MIME type", () => {
    const inspector = createBasicContentInspector()

    expect(
      inspector.inspect({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
        filename: "photo.jpg",
        expectedMimeType: "image/jpeg",
        kind: "image",
        size: 4,
      })
    ).toMatchObject({ accepted: true, detectedMimeType: "image/jpeg" })
  })

  it("rejects mismatched magic bytes", () => {
    const inspector = createBasicContentInspector()

    expect(
      inspector.inspect({
        buffer: Buffer.from("%PDF-1.7"),
        filename: "photo.jpg",
        expectedMimeType: "image/jpeg",
        kind: "image",
        size: 8,
      })
    ).toMatchObject({ accepted: false, detectedMimeType: "application/pdf" })
  })

  it("requires magic bytes for strict MIME types", () => {
    const inspector = createBasicContentInspector()

    expect(
      inspector.inspect({
        buffer: Buffer.from("not an image"),
        filename: "photo.jpg",
        expectedMimeType: "image/jpeg",
        kind: "image",
        size: 12,
      })
    ).toMatchObject({ accepted: false, detectedMimeType: null })
  })

  it("allows Office Open XML aliases for zip containers", () => {
    const inspector = createBasicContentInspector()

    expect(
      inspector.inspect({
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        filename: "sheet.xlsx",
        expectedMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        kind: "file",
        size: 4,
      })
    ).toMatchObject({ accepted: true, detectedMimeType: "application/zip" })
  })
})
