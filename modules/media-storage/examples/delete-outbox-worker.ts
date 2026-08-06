import { processObjectDeletionOutbox } from "@toolbox/media-storage/core"
import type {
  Logger,
  ObjectDeletionOutbox,
  ObjectStorageProvider,
} from "@toolbox/media-storage/ports"

export interface DeleteOutboxWorkerConfig {
  outbox: ObjectDeletionOutbox
  storage: ObjectStorageProvider
  logger?: Logger
  signal?: AbortSignal
}

export async function runDeleteOutboxWorkerOnce(config: DeleteOutboxWorkerConfig) {
  return await processObjectDeletionOutbox({
    outbox: config.outbox,
    storage: config.storage,
    logger: config.logger,
    signal: config.signal,
    limit: 100,
    lockMs: 60_000,
    retryDelayMs: 60_000,
    maxAttempts: 10,
  })
}

export async function runDeleteOutboxWorkerLoop(config: DeleteOutboxWorkerConfig): Promise<void> {
  while (!config.signal?.aborted) {
    const result = await runDeleteOutboxWorkerOnce(config)

    if (result.claimed === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
}
