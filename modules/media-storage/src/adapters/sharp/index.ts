import sharp, { type Sharp } from "sharp"

import { ImageProcessingError, InvalidMediaRequestError } from "../../domain/errors.js"
import type { ImageMetadata, MediaImageFormat, ProcessedImageVariant } from "../../domain/types.js"
import type {
  ExtractImageMetadataInput,
  ImageProcessor,
  NormalizeImageInput,
  ProcessImageVariantsInput,
  ValidateImageInput,
} from "../../ports/image-processor.js"

export interface SharpImageProcessorConfig {
  failOn?: "none" | "truncated" | "error" | "warning"
  normalizeMimeTypes?: readonly string[]
  normalizeFormat?: Extract<MediaImageFormat, "jpeg" | "png" | "webp">
  normalizeQuality?: number
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? ""
}

function assertKnownImageDimensions(metadata: {
  width?: number
  height?: number
}): asserts metadata is {
  width: number
  height: number
} {
  if (!metadata.width || !metadata.height) {
    throw new InvalidMediaRequestError("Unable to determine image dimensions.")
  }
}

async function encodeImage(
  pipeline: Sharp,
  format: MediaImageFormat,
  quality: number
): Promise<Sharp> {
  switch (format) {
    case "webp":
      return pipeline.webp({ quality })
    case "jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true })
    case "png":
      return pipeline.png({ quality })
    case "avif":
      return pipeline.avif({ quality })
    default:
      throw new InvalidMediaRequestError("Unsupported output image format.", { format })
  }
}

export class SharpImageProcessor implements ImageProcessor {
  private readonly failOn: "none" | "truncated" | "error" | "warning"
  private readonly normalizeMimeTypes: Set<string>
  private readonly normalizeFormat: Extract<MediaImageFormat, "jpeg" | "png" | "webp">
  private readonly normalizeQuality: number

  constructor(config: SharpImageProcessorConfig = {}) {
    this.failOn = config.failOn ?? "error"
    this.normalizeMimeTypes = new Set(
      (config.normalizeMimeTypes ?? ["image/heic", "image/heif"]).map(normalizeMimeType)
    )
    this.normalizeFormat = config.normalizeFormat ?? "jpeg"
    this.normalizeQuality = config.normalizeQuality ?? 95
  }

  async normalize(input: NormalizeImageInput): Promise<Buffer> {
    const mimeType = normalizeMimeType(input.mimeType)

    if (!this.normalizeMimeTypes.has(mimeType)) {
      return input.buffer
    }

    try {
      const pipeline = sharp(input.buffer, { failOn: this.failOn })
      const encoded = await encodeImage(pipeline, this.normalizeFormat, this.normalizeQuality)
      return await encoded.toBuffer()
    } catch (error) {
      throw new ImageProcessingError("Failed to normalize image source.", error, {
        mimeType: input.mimeType,
        normalizeFormat: this.normalizeFormat,
      })
    }
  }

  async extractMetadata(input: ExtractImageMetadataInput): Promise<ImageMetadata> {
    try {
      const metadata = await sharp(input.buffer, { failOn: this.failOn }).metadata()
      assertKnownImageDimensions(metadata)

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format ?? null,
        size: input.buffer.length,
      }
    } catch (error) {
      if (error instanceof InvalidMediaRequestError) {
        throw error
      }

      throw new ImageProcessingError("Failed to extract image metadata.", error, {
        mimeType: input.mimeType,
      })
    }
  }

  validate(input: ValidateImageInput): void {
    void input
    // Dimension validation is centralized in core to avoid adapter/core drift.
  }

  async processVariants(input: ProcessImageVariantsInput): Promise<ProcessedImageVariant[]> {
    const variants: ProcessedImageVariant[] = []

    for (const config of input.variants) {
      try {
        let pipeline = sharp(input.buffer, { failOn: this.failOn })

        if (config.height) {
          pipeline = pipeline.resize(config.width, config.height, {
            fit: config.fit ?? "cover",
            position: "center",
            withoutEnlargement: config.withoutEnlargement,
          })
        } else {
          pipeline = pipeline.resize(config.width, undefined, {
            fit: config.fit ?? "inside",
            withoutEnlargement: config.withoutEnlargement ?? true,
          })
        }

        const encoded = await encodeImage(pipeline, config.format, config.quality)
        const buffer = await encoded.toBuffer()
        const metadata = await sharp(buffer, { failOn: this.failOn }).metadata()
        assertKnownImageDimensions(metadata)

        variants.push({
          variantType: config.name,
          buffer,
          width: metadata.width,
          height: metadata.height,
          format: config.format,
          size: buffer.length,
        })
      } catch (error) {
        if (error instanceof InvalidMediaRequestError) {
          throw error
        }

        throw new ImageProcessingError("Failed to process image variant.", error, {
          variantType: config.name,
          format: config.format,
        })
      }
    }

    return variants
  }
}

export function createSharpImageProcessor(config?: SharpImageProcessorConfig): SharpImageProcessor {
  return new SharpImageProcessor(config)
}
