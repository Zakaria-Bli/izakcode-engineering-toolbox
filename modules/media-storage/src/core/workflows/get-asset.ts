import { AssetNotFoundError } from "../../domain/errors.js"
import { MediaAssetStatus } from "../../domain/states.js"
import type {
  GetAssetInput,
  MediaActorId,
  MediaAssetKind,
  MediaAssetWithVariants,
  MediaId,
} from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"

export async function getAsset<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: GetAssetInput<TAssetId, TActorId>
): Promise<MediaAssetWithVariants<TAssetId, TActorId, TKind>> {
  const assetWithVariants = await context.config.repository.findAssetWithVariants(input.assetId)

  if (!assetWithVariants || assetWithVariants.asset.status === MediaAssetStatus.DELETED) {
    throw new AssetNotFoundError(input.assetId)
  }

  await context.config.actorPolicy?.assertCanReadAsset?.({
    actorId: input.actorId,
    assetWithVariants,
  })

  return assetWithVariants
}
