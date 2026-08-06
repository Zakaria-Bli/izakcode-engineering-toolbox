import type {
  CreateUploadIntentInput,
  MediaActorId,
  MediaAssetKind,
  MediaId,
  UploadIntent,
} from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"
import { truncateFailureReason, validateCreateUploadIntentInput } from "../validation.js"

export async function createUploadIntent<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: CreateUploadIntentInput<TActorId, TKind>
): Promise<UploadIntent<TAssetId>> {
  const { clock, config, logger, policies } = context
  const validated = validateCreateUploadIntentInput(input, policies)
  context.assertStorageSupportsUploads()
  await config.actorPolicy?.assertCanCreateUpload?.({
    actorId: validated.actorId,
    input: validated,
  })

  const now = clock.now()
  const assetId = config.idGenerator.createAssetId?.() ?? null
  const sessionId = config.idGenerator.createSessionId()
  const objectNonce = config.idGenerator.createObjectNonce?.() ?? sessionId
  const objectKey = config.keyStrategy.buildOriginalObjectKey({
    assetId,
    sessionId,
    objectNonce,
    filename: validated.filename,
    mimeType: validated.mimeType,
    kind: validated.kind,
    pathPrefix: validated.pathPrefix,
    now,
  })
  config.keyStrategy.validateObjectKey(objectKey)

  const expiresAt = new Date(now.getTime() + policies.uploadSessionTtlMs)
  const record = await config.repository.createPendingUpload({
    assetId,
    sessionId,
    kind: validated.kind,
    provider: config.storage.name,
    bucket: config.storage.bucket ?? null,
    objectKey,
    publicUrl: null,
    originalFilename: validated.filename,
    mimeType: validated.mimeType,
    size: validated.size,
    ownerId: validated.actorId,
    expiresAt,
    now,
    metadata: validated.metadata,
  })

  try {
    const uploadTarget = await context.createUploadTarget({
      key: record.asset.objectKey,
      contentType: record.asset.mimeType,
      contentLength: record.asset.size,
      expiresInSeconds: Math.ceil(
        (policies.presignedUploadTtlMs ?? policies.uploadSessionTtlMs) / 1_000
      ),
    })

    return {
      uploadUrl: uploadTarget.uploadUrl,
      headers: uploadTarget.headers,
      fields: uploadTarget.fields,
      sessionId: record.session.id,
      assetId: record.asset.id,
      objectKey: record.asset.objectKey,
      expiresAt: record.session.expiresAt,
    }
  } catch (error) {
    await config.repository
      .failUpload({
        sessionId: record.session.id,
        assetId: record.asset.id,
        failureReason: truncateFailureReason(error),
        now: clock.now(),
      })
      .catch((failError) => {
        logger.error?.("Failed to mark media upload intent as failed.", {
          sessionId: record.session.id,
          assetId: record.asset.id,
          error: failError,
        })
      })
    throw error
  }
}
