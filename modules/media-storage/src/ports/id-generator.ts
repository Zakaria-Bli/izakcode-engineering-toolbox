import type { MediaId } from "../domain/types.js"

export interface IdGenerator<TAssetId extends MediaId = MediaId> {
  createAssetId?(): TAssetId
  createSessionId(): string
  createObjectNonce?(): string
}
