import type {
  ListAssetsInput,
  MediaActorId,
  MediaAsset,
  MediaAssetKind,
  MediaId,
  Page,
} from "../../domain/types.js"
import type { MediaStorageContext } from "../context.js"

export async function listAssets<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  context: MediaStorageContext<TAssetId, TActorId, TKind>,
  input: ListAssetsInput<TActorId> = {}
): Promise<Page<MediaAsset<TAssetId, TActorId, TKind>>> {
  await context.config.actorPolicy?.assertCanListAssets?.({
    actorId: input.actorId,
    filters: input,
  })

  return await context.config.repository.listAssets({
    page: input.page,
    pageSize: input.pageSize,
    status: input.status,
    kind: input.kind,
    search: input.search,
  })
}
