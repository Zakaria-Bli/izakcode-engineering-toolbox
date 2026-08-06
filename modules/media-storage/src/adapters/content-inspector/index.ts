import type { MediaAssetKind } from "../../domain/types.js"
import type {
  ContentInspector,
  InspectContentInput,
  InspectContentResult,
} from "../../ports/content-inspector.js"

export interface BasicContentInspectorConfig {
  /** Expected MIME types that must be detectable by magic bytes. */
  strictMimeTypes?: readonly string[]
  /** Additional accepted detected MIME types by expected MIME type. */
  allowedMimeAliases?: Record<string, readonly string[]>
  /** Reject when a known magic-byte MIME is detected but does not match the expected MIME. */
  rejectDetectedMismatch?: boolean
}

const DEFAULT_STRICT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "application/pdf",
]

const DEFAULT_MIME_ALIASES: Record<string, readonly string[]> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["application/zip"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["application/zip"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["application/zip"],
  "application/vnd.ms-excel": ["application/vnd.ms-office"],
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? ""
}

function hasPrefix(buffer: Buffer, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) {
    return false
  }

  return bytes.every((byte, index) => buffer[index] === byte)
}

function readAscii(buffer: Buffer, start: number, length: number): string {
  if (buffer.length < start + length) {
    return ""
  }

  return buffer.subarray(start, start + length).toString("ascii")
}

function hasIsoBaseMediaBrand(buffer: Buffer, brands: readonly string[]): boolean {
  if (readAscii(buffer, 4, 4) !== "ftyp") {
    return false
  }

  const haystack = buffer.subarray(8, Math.min(buffer.length, 64)).toString("ascii")
  return brands.some((brand) => haystack.includes(brand))
}

export function detectMimeTypeFromMagicBytes(buffer: Buffer): string | null {
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return "image/jpeg"
  }

  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png"
  }

  const gifHeader = readAscii(buffer, 0, 6)
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif"
  }

  if (readAscii(buffer, 0, 4) === "RIFF" && readAscii(buffer, 8, 4) === "WEBP") {
    return "image/webp"
  }

  if (hasIsoBaseMediaBrand(buffer, ["avif", "avis"])) {
    return "image/avif"
  }

  if (hasIsoBaseMediaBrand(buffer, ["heic", "heix", "hevc", "hevx"])) {
    return "image/heic"
  }

  if (hasIsoBaseMediaBrand(buffer, ["mif1", "msf1"])) {
    return "image/heif"
  }

  if (readAscii(buffer, 0, 5) === "%PDF-") {
    return "application/pdf"
  }

  if (hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    return "application/zip"
  }

  if (hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/vnd.ms-office"
  }

  if (hasPrefix(buffer, [0x4d, 0x5a])) {
    return "application/x-msdownload"
  }

  if (hasPrefix(buffer, [0x7f, 0x45, 0x4c, 0x46])) {
    return "application/x-elf"
  }

  return null
}

export class BasicContentInspector<TKind extends string = MediaAssetKind>
  implements ContentInspector<TKind>
{
  private readonly strictMimeTypes: Set<string>
  private readonly allowedMimeAliases: Map<string, Set<string>>
  private readonly rejectDetectedMismatch: boolean

  constructor(config: BasicContentInspectorConfig = {}) {
    this.strictMimeTypes = new Set(
      (config.strictMimeTypes ?? DEFAULT_STRICT_MIME_TYPES).map(normalizeMimeType)
    )
    this.allowedMimeAliases = new Map(
      Object.entries({ ...DEFAULT_MIME_ALIASES, ...config.allowedMimeAliases }).map(
        ([mimeType, aliases]) => [
          normalizeMimeType(mimeType),
          new Set(aliases.map(normalizeMimeType)),
        ]
      )
    )
    this.rejectDetectedMismatch = config.rejectDetectedMismatch ?? true
  }

  inspect(input: InspectContentInput<TKind>): InspectContentResult {
    const expectedMimeType = normalizeMimeType(input.expectedMimeType)
    const detectedMimeType = detectMimeTypeFromMagicBytes(input.buffer)
    const normalizedDetectedMimeType = detectedMimeType ? normalizeMimeType(detectedMimeType) : null

    if (!normalizedDetectedMimeType) {
      if (this.strictMimeTypes.has(expectedMimeType)) {
        return {
          accepted: false,
          detectedMimeType: null,
          reason: "Expected MIME type requires recognizable magic bytes.",
        }
      }

      return { accepted: true, detectedMimeType: null }
    }

    const aliases = this.allowedMimeAliases.get(expectedMimeType)
    const matchesExpected =
      normalizedDetectedMimeType === expectedMimeType || aliases?.has(normalizedDetectedMimeType)

    if (!matchesExpected && this.rejectDetectedMismatch) {
      return {
        accepted: false,
        detectedMimeType: normalizedDetectedMimeType,
        reason: "Detected MIME type does not match expected MIME type.",
      }
    }

    return { accepted: true, detectedMimeType: normalizedDetectedMimeType }
  }
}

export function createBasicContentInspector<TKind extends string = MediaAssetKind>(
  config?: BasicContentInspectorConfig
): BasicContentInspector<TKind> {
  return new BasicContentInspector<TKind>(config)
}
