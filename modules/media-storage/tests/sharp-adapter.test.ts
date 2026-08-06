import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { createSharpImageProcessor } from "../src/adapters/sharp/index.js"
import { ImageProcessingError, InvalidMediaRequestError } from "../src/domain/errors.js"
import type { MediaImageFormat } from "../src/domain/types.js"

async function createImageBuffer(input: {
  width: number
  height: number
  format?: "jpeg" | "png" | "webp"
}): Promise<Buffer> {
  const image = sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 3,
      background: { r: 90, g: 130, b: 200 },
    },
  })

  switch (input.format ?? "png") {
    case "jpeg":
      return await image.jpeg({ quality: 90 }).toBuffer()
    case "webp":
      return await image.webp({ quality: 90 }).toBuffer()
    case "png":
      return await image.png().toBuffer()
  }
}

describe("SharpImageProcessor", () => {
  it("extracts real image metadata", async () => {
    const processor = createSharpImageProcessor()
    const buffer = await createImageBuffer({ width: 320, height: 240, format: "png" })

    await expect(processor.extractMetadata({ buffer, mimeType: "image/png" })).resolves.toEqual({
      width: 320,
      height: 240,
      format: "png",
      size: buffer.length,
    })
  })

  it("normalizes configured MIME types and leaves others unchanged", async () => {
    const processor = createSharpImageProcessor({
      normalizeMimeTypes: ["IMAGE/PNG"],
      normalizeFormat: "jpeg",
      normalizeQuality: 82,
    })
    const png = await createImageBuffer({ width: 64, height: 48, format: "png" })

    const normalized = await processor.normalize({
      buffer: png,
      mimeType: "image/png; charset=binary",
    })
    const normalizedMetadata = await sharp(normalized).metadata()
    const untouched = await processor.normalize({ buffer: png, mimeType: "image/jpeg" })

    expect(normalizedMetadata).toMatchObject({ width: 64, height: 48, format: "jpeg" })
    expect(untouched).toBe(png)
  })

  it("creates resized variants with correct dimensions, formats, and sizes", async () => {
    const processor = createSharpImageProcessor()
    const buffer = await createImageBuffer({ width: 400, height: 300, format: "jpeg" })

    const variants = await processor.processVariants({
      buffer,
      variants: [
        {
          name: "square",
          width: 100,
          height: 100,
          quality: 80,
          format: "webp",
          fit: "cover",
        },
        {
          name: "wide",
          width: 200,
          quality: 90,
          format: "jpeg",
        },
      ],
    })

    expect(variants).toHaveLength(2)
    expect(variants[0]).toMatchObject({
      variantType: "square",
      width: 100,
      height: 100,
      format: "webp",
    })
    expect(variants[0]?.size).toBe(variants[0]?.buffer.length)
    await expect(sharp(variants[0]?.buffer).metadata()).resolves.toMatchObject({
      width: 100,
      height: 100,
      format: "webp",
    })

    expect(variants[1]).toMatchObject({
      variantType: "wide",
      width: 200,
      height: 150,
      format: "jpeg",
    })
    expect(variants[1]?.size).toBe(variants[1]?.buffer.length)
    await expect(sharp(variants[1]?.buffer).metadata()).resolves.toMatchObject({
      width: 200,
      height: 150,
      format: "jpeg",
    })
  })

  it("does not enlarge width-only variants by default", async () => {
    const processor = createSharpImageProcessor()
    const buffer = await createImageBuffer({ width: 80, height: 60, format: "jpeg" })

    const [variant] = await processor.processVariants({
      buffer,
      variants: [{ name: "large", width: 200, quality: 90, format: "jpeg" }],
    })

    expect(variant).toMatchObject({ width: 80, height: 60 })
  })

  it("wraps invalid image input in ImageProcessingError", async () => {
    const processor = createSharpImageProcessor()

    await expect(
      processor.extractMetadata({ buffer: Buffer.from("not an image"), mimeType: "image/png" })
    ).rejects.toBeInstanceOf(ImageProcessingError)
  })

  it("rejects unsupported output formats before encoding", async () => {
    const processor = createSharpImageProcessor()
    const buffer = await createImageBuffer({ width: 64, height: 64, format: "png" })

    await expect(
      processor.processVariants({
        buffer,
        variants: [
          {
            name: "bad",
            width: 32,
            quality: 80,
            format: "tiff" as MediaImageFormat,
          },
        ],
      })
    ).rejects.toBeInstanceOf(InvalidMediaRequestError)
  })
})
