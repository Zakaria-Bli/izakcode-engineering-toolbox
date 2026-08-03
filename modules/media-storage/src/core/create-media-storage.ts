import type {
  CancelUploadInput,
  CleanupMediaInput,
  CleanupPlan,
  CleanupResult,
  CompleteUploadInput,
  CompleteUploadResult,
  CreateUploadIntentInput,
  DeleteAssetInput,
  DownloadUrlResult,
  GetAssetInput,
  GetDownloadUrlInput,
  ListAssetsInput,
  MediaActorId,
  MediaAsset,
  MediaAssetKind,
  MediaAssetWithVariants,
  MediaId,
  MoveAssetsInput,
  MoveAssetsResult,
  Page,
  UploadIntent,
} from "../domain/types.js"
import { createMediaStorageContext } from "./context.js"
import type {
  MediaStorageActorPolicy,
  MediaStorageConfig,
  MediaStorageService,
} from "./service-types.js"
import { cancelUpload as runCancelUpload } from "./workflows/cancel-upload.js"
import { cleanup as runCleanup, planCleanup as runPlanCleanup } from "./workflows/cleanup.js"
import { completeUpload as runCompleteUpload } from "./workflows/complete-upload.js"
import { createUploadIntent as runCreateUploadIntent } from "./workflows/create-upload-intent.js"
import { deleteAsset as runDeleteAsset } from "./workflows/delete-asset.js"
import { getAsset as runGetAsset } from "./workflows/get-asset.js"
import { getDownloadUrl as runGetDownloadUrl } from "./workflows/get-download-url.js"
import { listAssets as runListAssets } from "./workflows/list-assets.js"
import { moveAssets as runMoveAssets } from "./workflows/move-assets.js"

export type { MediaStorageActorPolicy, MediaStorageConfig, MediaStorageService }

/** Create a framework-agnostic media storage service from injected ports and policies. */
export function createMediaStorage<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  config: MediaStorageConfig<TAssetId, TActorId, TKind>
): MediaStorageService<TAssetId, TActorId, TKind> {
  const context = createMediaStorageContext(config)

  return {
    createUploadIntent(
      input: CreateUploadIntentInput<TActorId, TKind>
    ): Promise<UploadIntent<TAssetId>> {
      return runCreateUploadIntent(context, input)
    },

    completeUpload(
      input: CompleteUploadInput<TActorId>
    ): Promise<CompleteUploadResult<TAssetId, TActorId, TKind>> {
      return runCompleteUpload(context, input)
    },

    cancelUpload(input: CancelUploadInput<TActorId>): Promise<void> {
      return runCancelUpload(context, input)
    },

    getAsset(
      input: GetAssetInput<TAssetId, TActorId>
    ): Promise<MediaAssetWithVariants<TAssetId, TActorId, TKind>> {
      return runGetAsset(context, input)
    },

    listAssets(
      input?: ListAssetsInput<TActorId>
    ): Promise<Page<MediaAsset<TAssetId, TActorId, TKind>>> {
      return runListAssets(context, input)
    },

    getDownloadUrl(input: GetDownloadUrlInput<TAssetId, TActorId>): Promise<DownloadUrlResult> {
      return runGetDownloadUrl(context, input)
    },

    deleteAsset(input: DeleteAssetInput<TAssetId, TActorId>): Promise<void> {
      return runDeleteAsset(context, input)
    },

    moveAssets(input: MoveAssetsInput<TAssetId, TActorId>): Promise<MoveAssetsResult<TAssetId>> {
      return runMoveAssets(context, input)
    },

    planCleanup(input?: CleanupMediaInput): Promise<CleanupPlan<TAssetId>> {
      return runPlanCleanup(context, input)
    },

    cleanup(input?: CleanupMediaInput): Promise<CleanupResult<TAssetId>> {
      return runCleanup(context, input)
    },
  }
}
