import {
  AssetInUseError,
  AssetNotFoundError,
  MediaConfigurationError,
} from "../../domain/errors.js"
import { MediaAssetStatus } from "../../domain/states.js"
import type { DeleteAssetInput, MediaActorId, MediaAssetKind, MediaId } from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"

export async function deleteAsset<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: DeleteAssetInput<TAssetId, TActorId>
): Promise<void> {
  const { clock, config, policies } = context
  const assetWithVariants = await config.repository.findAssetWithVariants(input.assetId)

  if (!assetWithVariants || assetWithVariants.asset.status === MediaAssetStatus.DELETED) {
    throw new AssetNotFoundError(input.assetId)
  }

  await config.actorPolicy?.assertCanDeleteAsset?.({
    actorId: input.actorId,
    assetWithVariants,
  })

  const usage = config.assetUsagePolicy
    ? await config.assetUsagePolicy({
        actorId: input.actorId,
        asset: assetWithVariants.asset,
      })
    : { inUse: false }

  if (usage.inUse) {
    throw new AssetInUseError(input.assetId, usage.details)
  }

  const objectKeys = [
    assetWithVariants.asset.objectKey,
    ...assetWithVariants.variants.map((variant) => variant.objectKey),
  ]
  const deletionRequests = context.createObjectDeletionRequests({
    keys: objectKeys,
    reason: "asset_deleted",
    assetId: input.assetId,
  })

  const writeDeletion = async (repository: typeof config.repository): Promise<void> => {
    await repository.markAssetDeleted({
      assetId: input.assetId,
      deletionMode: policies.deletionMode,
      now: clock.now(),
    })
    await context.enqueueObjectDeletions(repository, deletionRequests)
  }

  if (policies.objectDeletionMode === "outbox") {
    if (!config.repository.transaction) {
      throw new MediaConfigurationError(
        "policies.objectDeletionMode='outbox' requires repository.transaction()."
      )
    }
    await config.repository.transaction(writeDeletion)
  } else {
    await writeDeletion(config.repository)
  }

  await context.deleteObjectsBestEffort(
    objectKeys,
    "Failed to delete media object during asset deletion.",
    {
      assetId: input.assetId,
    }
  )
}
