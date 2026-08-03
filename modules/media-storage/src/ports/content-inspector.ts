import type { MediaAssetKind } from "../domain/types.js"

/** Input passed to content inspectors during upload completion after object download. */
export interface InspectContentInput<TKind extends string = MediaAssetKind> {
  buffer: Buffer
  filename: string
  expectedMimeType: string
  kind: TKind
  size: number
  metadata?: Record<string, unknown> | null
  signal?: AbortSignal
}

/** Content-inspection result. Return `accepted: false` or a mismatched MIME to reject completion. */
export interface InspectContentResult {
  detectedMimeType?: string | null
  accepted?: boolean
  reason?: string
  details?: Record<string, unknown>
}

/** Optional security port for magic-byte detection, malware scanning, or app-specific content checks. */
export interface ContentInspector<TKind extends string = MediaAssetKind> {
  inspect(input: InspectContentInput<TKind>): Promise<InspectContentResult> | InspectContentResult
}
