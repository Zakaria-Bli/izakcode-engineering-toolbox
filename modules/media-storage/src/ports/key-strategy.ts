import type { MediaId, MediaVariantType } from "../domain/types.js"

export interface BuildOriginalObjectKeyInput<TAssetId extends MediaId = MediaId> {
  assetId?: TAssetId | null
  sessionId: string
  objectNonce: string
  filename: string
  mimeType: string
  kind: string
  pathPrefix?: string | null
  now: Date
}

export interface BuildVariantObjectKeyInput<TAssetId extends MediaId = MediaId> {
  assetId: TAssetId
  originalObjectKey: string
  variantType: MediaVariantType
  format: string
  createdAt: Date
}

export interface BuildMovedObjectKeyInput<TAssetId extends MediaId = MediaId> {
  assetId: TAssetId
  fromKey: string
  toPrefix: string
  objectType: "original" | "variant"
  variantType?: MediaVariantType
  format?: string
  now: Date
}

export interface ObjectKeyStrategy<TAssetId extends MediaId = MediaId> {
  buildOriginalObjectKey(input: BuildOriginalObjectKeyInput<TAssetId>): string
  buildVariantObjectKey(input: BuildVariantObjectKeyInput<TAssetId>): string
  buildMovedObjectKey?(input: BuildMovedObjectKeyInput<TAssetId>): string
  getSafeExtension(mimeType: string, filename?: string): string | null
  validateObjectKey(key: string): void
}
