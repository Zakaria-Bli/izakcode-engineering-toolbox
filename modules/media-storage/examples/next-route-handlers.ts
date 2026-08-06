import type { MediaStorageService, ObjectStorageProvider } from "@toolbox/media-storage"
import {
  createNextLocalPutObjectHandler,
  createNextMediaRouteHandlers,
} from "@toolbox/media-storage/adapters/next"

function getActorId(request: Request): string | null {
  return request.headers.get("x-actor-id")
}

export function createAppRouterMediaHandlers(
  media: MediaStorageService<string, string, "image" | "file">
) {
  return createNextMediaRouteHandlers({
    media,
    getActorId,
    authorize: ({ action, actorId }) => {
      if (!actorId) {
        throw new Error(`Missing actor for media action: ${action}`)
      }
    },
  })
}

export function createLocalUploadHandler(storage: ObjectStorageProvider, signingSecret: string) {
  return createNextLocalPutObjectHandler({
    storage,
    signingSecret,
    getActorId,
    authorize: ({ actorId }) => {
      if (!actorId) {
        throw new Error("Missing actor for local media upload.")
      }
    },
  })
}

/*
Next.js route file sketch:

const handlers = createAppRouterMediaHandlers(media)
export const POST = handlers.createUploadIntent

For dynamic routes:

export const POST = handlers.completeUpload
// app/api/media/uploads/[sessionId]/complete/route.ts
*/
