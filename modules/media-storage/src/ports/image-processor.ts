import type {
  ImageMetadata,
  ImageVariantDefinition,
  MediaImageFormat,
  ProcessedImageVariant,
} from "../domain/types.js"

export interface ImageDimensionLimits {
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

export interface NormalizeImageInput {
  buffer: Buffer
  mimeType: string
  signal?: AbortSignal
}

export interface ExtractImageMetadataInput {
  buffer: Buffer
  mimeType?: string
  signal?: AbortSignal
}

export interface ValidateImageInput {
  metadata: ImageMetadata
  limits: ImageDimensionLimits
  signal?: AbortSignal
}

export interface ProcessImageVariantsInput {
  buffer: Buffer
  variants: ImageVariantDefinition[]
  signal?: AbortSignal
}

export interface ImageProcessor {
  normalize?(input: NormalizeImageInput): Promise<Buffer>
  extractMetadata(input: ExtractImageMetadataInput): Promise<ImageMetadata>
  validate?(input: ValidateImageInput): Promise<void> | void
  processVariants(input: ProcessImageVariantsInput): Promise<ProcessedImageVariant[]>
}

export interface ImageProcessorVariantOutputOptions {
  format: MediaImageFormat
  contentType: string
}
