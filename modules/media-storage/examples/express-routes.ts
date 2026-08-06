import {
  createExpressMediaAdapter,
  createExpressMediaErrorMiddleware,
  type ExpressLikeErrorHandler,
  type ExpressLikeHandler,
  type ExpressLikeRequest,
} from "@toolbox/media-storage/adapters/express"
import type { MediaStorageService } from "@toolbox/media-storage/core"

interface ExpressLikeRouter {
  post(path: string, handler: ExpressLikeHandler): void
  delete(path: string, handler: ExpressLikeHandler): void
  use(handler: ExpressLikeErrorHandler): void
}

function readActorId(request: ExpressLikeRequest): string | null {
  return request.header("x-actor-id") ?? null
}

export function mountMediaRoutes(
  router: ExpressLikeRouter,
  media: MediaStorageService<string, string, "image" | "file">
): void {
  const handlers = createExpressMediaAdapter({
    media,
    getActorId: readActorId,
    authorize: ({ action, actorId }) => {
      if (!actorId) {
        throw new Error(`Missing actor for media action: ${action}`)
      }
    },
  })

  router.post("/media/uploads", handlers.createUploadIntent)
  router.post("/media/uploads/:sessionId/complete", handlers.completeUpload)
  router.post("/media/uploads/:sessionId/cancel", handlers.cancelUpload)
  router.delete("/media/assets/:assetId", handlers.deleteAsset)
  router.post("/media/assets/move", handlers.moveAssets)
  router.post("/media/cleanup", handlers.cleanup)
  router.use(createExpressMediaErrorMiddleware())
}
