import { InvalidMediaRequestError } from "../../domain/errors.js"
import type {
  CleanupMediaInput,
  CleanupPlan,
  CleanupResult,
  MediaActorId,
  MediaAssetKind,
  MediaId,
} from "../../domain/types.js"
import type { MediaRepository } from "../../ports/media-repository.js"
import type { MediaStorageContext } from "../context.js"

export async function planCleanup<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: CleanupMediaInput = {}
): Promise<CleanupPlan<TAssetId>> {
  const { clock, config, policies } = context
  const limit = input.limit ?? 100

  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new InvalidMediaRequestError("Cleanup limit must be an integer between 1 and 1000.", {
      limit,
    })
  }

  const now = clock.now()
  const cutoff = new Date(now.getTime() - policies.orphanTtlMs)
  const candidates = await config.repository.findCleanupCandidates({ now, cutoff, limit })
  const skippedAssetIds: TAssetId[] = []
  const items: CleanupPlan<TAssetId>["items"] = []
  const objectKeys = new Set<string>()
  const assetIds = new Set<TAssetId>()
  const sessionIds = new Set<string>()

  for (const candidate of candidates) {
    const usage = config.assetUsagePolicy
      ? await config.assetUsagePolicy({ asset: candidate.asset })
      : { inUse: false }

    if (usage.inUse) {
      skippedAssetIds.push(candidate.asset.id)
      continue
    }

    const itemObjectKeys = [
      candidate.asset.objectKey,
      ...candidate.variants.map((variant) => variant.objectKey),
    ]

    for (const objectKey of itemObjectKeys) {
      objectKeys.add(objectKey)
    }

    assetIds.add(candidate.asset.id)

    if (candidate.sessionId) {
      sessionIds.add(candidate.sessionId)
    }

    items.push({
      assetId: candidate.asset.id,
      sessionId: candidate.sessionId ?? null,
      reason: candidate.reason,
      objectKeys: itemObjectKeys,
    })
  }

  return {
    cutoff,
    items,
    objectKeys: Array.from(objectKeys),
    assetIds: Array.from(assetIds),
    sessionIds: Array.from(sessionIds),
    skippedAssetIds,
  }
}

export async function cleanup<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: CleanupMediaInput = {}
): Promise<CleanupResult<TAssetId>> {
  const { clock, config, policies } = context
  const plan = await planCleanup(context, input)
  const deletedKeys = new Set<string>()
  const missingKeys = new Set<string>()
  const failedKeys = new Set<string>()
  const cleanedAssetIds = new Set<TAssetId>()
  const cleanedSessionIds = new Set<string>()

  await context.deleteObjectsForCleanup(plan.objectKeys, { deletedKeys, missingKeys, failedKeys })

  for (const item of plan.items) {
    const deletedAllObjects = item.objectKeys.every(
      (objectKey) => deletedKeys.has(objectKey) || missingKeys.has(objectKey)
    )

    if (!deletedAllObjects) {
      continue
    }

    cleanedAssetIds.add(item.assetId)
    if (item.sessionId) {
      cleanedSessionIds.add(item.sessionId)
    }
  }

  const now = clock.now()
  const writeCleanup = async (
    repository: MediaRepository<TAssetId, TActorId, TKind>
  ): Promise<void> => {
    await repository.markUploadSessionsExpired(Array.from(cleanedSessionIds), now)

    const assetIds = Array.from(cleanedAssetIds)
    if (repository.markAssetsDeleted) {
      await repository.markAssetsDeleted({
        assetIds,
        deletionMode: policies.deletionMode,
        now,
      })
      return
    }

    for (const assetId of assetIds) {
      await repository.markAssetDeleted({
        assetId,
        deletionMode: policies.deletionMode,
        now,
      })
    }
  }

  if (config.repository.transaction) {
    await config.repository.transaction(writeCleanup)
  } else {
    await writeCleanup(config.repository)
  }

  return {
    plan,
    deletedObjects: deletedKeys.size,
    missingObjects: missingKeys.size,
    failedObjects: failedKeys.size,
    deletedAssets: cleanedAssetIds.size,
    expiredSessions: cleanedSessionIds.size,
    skippedAssets: plan.skippedAssetIds.length,
  }
}
