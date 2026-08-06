import {
  MediaConfigurationError,
  UploadSessionNotFoundError,
  UploadSessionStateError,
} from "../../domain/errors.js"
import { MediaAssetStatus, MediaUploadSessionStatus } from "../../domain/states.js"
import type {
  CancelUploadInput,
  MediaActorId,
  MediaAssetKind,
  MediaId,
} from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"

export async function cancelUpload<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: CancelUploadInput<TActorId>
): Promise<void> {
  const { clock, config, policies } = context
  const record = await config.repository.findUploadSessionWithAsset(input.sessionId)

  if (!record) {
    throw new UploadSessionNotFoundError(input.sessionId)
  }

  await config.actorPolicy?.assertCanCancelUpload?.({
    actorId: input.actorId,
    record,
  })

  if (record.session.status !== MediaUploadSessionStatus.AWAITING) {
    throw new UploadSessionStateError(record.session.id, record.session.status)
  }

  if (record.asset.status !== MediaAssetStatus.PENDING_UPLOAD) {
    throw new UploadSessionStateError(record.session.id, `asset:${record.asset.status}`, {
      assetId: record.asset.id,
    })
  }

  const deletionRequests = context.createObjectDeletionRequests({
    keys: [record.asset.objectKey],
    reason: "upload_cancelled",
    assetId: record.asset.id,
    sessionId: record.session.id,
  })

  const writeCancellation = async (repository: typeof config.repository): Promise<void> => {
    await repository.cancelUpload({
      sessionId: record.session.id,
      assetId: record.asset.id,
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
    await config.repository.transaction(writeCancellation)
  } else {
    await writeCancellation(config.repository)
  }

  await context.deleteObjectBestEffort(
    record.asset.objectKey,
    "Failed to delete media object during upload cancellation.",
    { sessionId: record.session.id, assetId: record.asset.id }
  )
}
