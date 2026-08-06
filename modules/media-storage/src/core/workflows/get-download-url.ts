import {
  AssetNotFoundError,
  CapabilityNotSupportedError,
  InvalidMediaRequestError,
} from "../../domain/errors.js"
import type {
  DownloadUrlResult,
  GetDownloadUrlInput,
  MediaActorId,
  MediaAssetKind,
  MediaId,
} from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"
import { getImageContentType } from "../context.js"
import { getAsset } from "./get-asset.js"

export async function getDownloadUrl<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: GetDownloadUrlInput<TAssetId, TActorId>
): Promise<DownloadUrlResult> {
  const { clock, config, policies } = context
  const assetWithVariants = await getAsset(context, {
    assetId: input.assetId,
    actorId: input.actorId,
  })
  const variant = input.variantType
    ? assetWithVariants.variants.find((entry) => entry.variantType === input.variantType)
    : null

  if (input.variantType && !variant) {
    throw new AssetNotFoundError(input.assetId)
  }

  const objectKey = variant?.objectKey ?? assetWithVariants.asset.objectKey
  const publicUrl = variant?.publicUrl ?? assetWithVariants.asset.publicUrl
  const contentType = variant
    ? getImageContentType(variant.format)
    : assetWithVariants.asset.mimeType
  const signedUrlRequested = input.preferSignedUrl || input.expiresInSeconds !== undefined
  const useSignedUrl = signedUrlRequested || !publicUrl

  if (useSignedUrl) {
    if (!config.storage.createPresignedGetUrl) {
      throw new CapabilityNotSupportedError("createPresignedGetUrl", {
        provider: config.storage.name,
        signedUrlRequested,
      })
    }

    const expiresInSeconds = input.expiresInSeconds ?? 300
    const maxDownloadUrlExpirySeconds = policies.maxDownloadUrlExpirySeconds ?? 3_600
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1) {
      throw new InvalidMediaRequestError("Download URL expiry must be a positive integer.", {
        expiresInSeconds,
      })
    }
    if (expiresInSeconds > maxDownloadUrlExpirySeconds) {
      throw new InvalidMediaRequestError("Download URL expiry exceeds maximum.", {
        expiresInSeconds,
        maxDownloadUrlExpirySeconds,
      })
    }

    const url = await context.retry(
      "createPresignedGetUrl",
      () =>
        config.storage.createPresignedGetUrl?.({
          key: objectKey,
          expiresInSeconds,
          responseContentType: contentType ?? undefined,
          responseContentDisposition: input.responseContentDisposition,
        }) ?? Promise.reject(new CapabilityNotSupportedError("createPresignedGetUrl"))
    )

    return {
      url,
      objectKey,
      publicUrl,
      expiresAt: new Date(clock.now().getTime() + expiresInSeconds * 1_000),
      contentType,
    }
  }

  if (publicUrl) {
    return { url: publicUrl, objectKey, publicUrl, expiresAt: null, contentType }
  }

  const generatedPublicUrl = context.getConfiguredPublicUrl(objectKey)
  if (generatedPublicUrl) {
    return {
      url: generatedPublicUrl,
      objectKey,
      publicUrl: generatedPublicUrl,
      expiresAt: null,
      contentType,
    }
  }

  throw new CapabilityNotSupportedError("downloadUrl", { provider: config.storage.name })
}
