import {
  AssetNotFoundError,
  CapabilityNotSupportedError,
  InvalidMediaRequestError,
} from "../../domain/errors.js"
import { MediaAssetStatus } from "../../domain/states.js"
import type {
  MediaActorId,
  MediaAssetKind,
  MediaAssetWithVariants,
  MediaId,
  MoveAssetsInput,
  MoveAssetsResult,
} from "../../domain/types.js"
import type { MediaRepository } from "../../ports/media-repository.js"
import type { MediaStorageContext } from "../context.js"
import { buildDefaultMovedObjectKey } from "../context.js"
import { assertAllowedPathPrefix, normalizePathPrefix } from "../validation.js"

interface MoveOperation<
  TAssetId extends MediaId,
  TActorId extends MediaActorId,
  TKind extends string,
> {
  assetWithVariants: MediaAssetWithVariants<TAssetId, TActorId, TKind>
  newObjectKey: string
  newPublicUrl: string | null
  variantMoves: {
    variantId: MediaId
    fromKey: string
    toKey: string
    publicUrl: string | null
  }[]
}

export async function moveAssets<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: MoveAssetsInput<TAssetId, TActorId>
): Promise<MoveAssetsResult<TAssetId>> {
  const { clock, config, policies } = context
  const toPrefix = normalizePathPrefix(input.toPrefix)

  if (!toPrefix) {
    throw new InvalidMediaRequestError("Move target prefix is required.")
  }

  assertAllowedPathPrefix(toPrefix, policies)
  config.keyStrategy.validateObjectKey(`${toPrefix}/placeholder`)

  const assetIds = Array.from(new Set(input.assetIds))
  if (!assetIds.length) {
    return { assets: [] }
  }

  if (!config.storage.copyObject) {
    throw new CapabilityNotSupportedError("copyObject", { provider: config.storage.name })
  }

  const copyObject = config.storage.copyObject.bind(config.storage)
  const assetRecords = await config.repository.findAssetsWithVariants(assetIds)
  const foundAssetIds = new Set(assetRecords.map((record) => record.asset.id))

  for (const assetId of assetIds) {
    if (!foundAssetIds.has(assetId)) {
      throw new AssetNotFoundError(assetId)
    }
  }

  const operations: MoveOperation<TAssetId, TActorId, TKind>[] = []
  const targetKeys = new Map<string, string>()
  const assertUniqueTargetKey = (toKey: string, fromKey: string): void => {
    const existingFromKey = targetKeys.get(toKey)
    if (existingFromKey && existingFromKey !== fromKey) {
      throw new InvalidMediaRequestError("Move target object key collision.", {
        fromKey,
        existingFromKey,
        toKey,
      })
    }
    targetKeys.set(toKey, fromKey)
  }

  for (const assetWithVariants of assetRecords) {
    if (assetWithVariants.asset.status === MediaAssetStatus.DELETED) {
      throw new AssetNotFoundError(assetWithVariants.asset.id)
    }

    await config.actorPolicy?.assertCanMoveAsset?.({
      actorId: input.actorId,
      assetWithVariants,
      toPrefix,
    })

    const newObjectKey =
      config.keyStrategy.buildMovedObjectKey?.({
        assetId: assetWithVariants.asset.id,
        fromKey: assetWithVariants.asset.objectKey,
        toPrefix,
        objectType: "original",
        now: clock.now(),
      }) ??
      buildDefaultMovedObjectKey(
        toPrefix,
        assetWithVariants.asset.id,
        assetWithVariants.asset.objectKey
      )
    config.keyStrategy.validateObjectKey(newObjectKey)
    assertUniqueTargetKey(newObjectKey, assetWithVariants.asset.objectKey)

    const variantMoves = assetWithVariants.variants.map((variant) => {
      const toKey =
        config.keyStrategy.buildMovedObjectKey?.({
          assetId: assetWithVariants.asset.id,
          fromKey: variant.objectKey,
          toPrefix,
          objectType: "variant",
          variantType: variant.variantType,
          format: variant.format,
          now: clock.now(),
        }) ?? buildDefaultMovedObjectKey(toPrefix, assetWithVariants.asset.id, variant.objectKey)
      config.keyStrategy.validateObjectKey(toKey)
      assertUniqueTargetKey(toKey, variant.objectKey)

      return {
        variantId: variant.id,
        fromKey: variant.objectKey,
        toKey,
        publicUrl: context.getConfiguredPublicUrl(toKey),
      }
    })

    operations.push({
      assetWithVariants,
      newObjectKey,
      newPublicUrl: context.getConfiguredPublicUrl(newObjectKey),
      variantMoves,
    })
  }

  const copiedObjects: { fromKey: string; toKey: string }[] = []

  try {
    for (const operation of operations) {
      const asset = operation.assetWithVariants.asset

      if (asset.objectKey !== operation.newObjectKey) {
        await context.retry("copyObject", () =>
          copyObject({ fromKey: asset.objectKey, toKey: operation.newObjectKey })
        )
        copiedObjects.push({ fromKey: asset.objectKey, toKey: operation.newObjectKey })
      }

      for (const variantMove of operation.variantMoves) {
        if (variantMove.fromKey === variantMove.toKey) {
          continue
        }

        await context.retry("copyVariantObject", () =>
          copyObject({ fromKey: variantMove.fromKey, toKey: variantMove.toKey })
        )
        copiedObjects.push({ fromKey: variantMove.fromKey, toKey: variantMove.toKey })
      }
    }

    const writeUpdates = async (
      repository: MediaRepository<TAssetId, TActorId, TKind>
    ): Promise<void> => {
      const now = clock.now()
      const updates = operations.map((operation) => ({
        assetId: operation.assetWithVariants.asset.id,
        objectKey: operation.newObjectKey,
        publicUrl: operation.newPublicUrl,
        variants: operation.variantMoves.map((variantMove) => ({
          variantId: variantMove.variantId,
          objectKey: variantMove.toKey,
          publicUrl: variantMove.publicUrl,
        })),
        now,
      }))

      if (repository.updateAssetObjectKeysBatch) {
        await repository.updateAssetObjectKeysBatch({ updates })
      } else {
        for (const update of updates) {
          await repository.updateAssetObjectKeys(update)
        }
      }

      await context.enqueueObjectDeletions(
        repository,
        context.createObjectDeletionRequests({
          keys: copiedObjects.map((copied) => copied.fromKey),
          reason: "move_source",
          context: { toPrefix },
        })
      )
    }

    if (config.repository.transaction) {
      await config.repository.transaction(writeUpdates)
    } else {
      await writeUpdates(config.repository)
    }

    await context.deleteObjectsBestEffort(
      copiedObjects.map((copied) => copied.fromKey),
      "Failed to delete source media object after move."
    )

    return {
      assets: operations.map((operation) => ({
        assetId: operation.assetWithVariants.asset.id,
        objectKey: operation.newObjectKey,
        publicUrl: operation.newPublicUrl,
        variants: operation.variantMoves.map((variantMove) => ({
          variantId: variantMove.variantId,
          objectKey: variantMove.toKey,
          publicUrl: variantMove.publicUrl,
        })),
      })),
    }
  } catch (error) {
    for (const copied of copiedObjects.reverse()) {
      await context.deleteObjectBestEffort(
        copied.toKey,
        "Failed to roll back copied media object after move failure.",
        { fromKey: copied.fromKey }
      )
    }

    throw error
  }
}
