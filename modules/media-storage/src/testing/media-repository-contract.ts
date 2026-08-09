import assert from "node:assert/strict"

import { MediaAssetStatus, MediaUploadSessionStatus } from "../domain/states.js"
import type {
  CompleteUploadResult,
  MediaActorId,
  MediaAssetKind,
  MediaId,
} from "../domain/types.js"
import type { MediaRepository } from "../ports/media-repository.js"

export interface MediaRepositoryContractRunner {
  describe(name: string, task: () => void): void
  it(name: string, task: () => Promise<void> | void): void
}

export interface MediaRepositoryContractHarness<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
> {
  createRepository():
    MediaRepository<TAssetId, TActorId, TKind> | Promise<MediaRepository<TAssetId, TActorId, TKind>>
  cleanupRepository?(repository: MediaRepository<TAssetId, TActorId, TKind>): Promise<void> | void
  kind: TKind
  actorId?: TActorId | null
  createAssetId?(seed: string): TAssetId | null | undefined
  now?: Date
}

function createPendingInput<
  TAssetId extends MediaId,
  TActorId extends MediaActorId,
  TKind extends string,
>(harness: MediaRepositoryContractHarness<TAssetId, TActorId, TKind>, seed: string) {
  const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
  return {
    assetId: harness.createAssetId?.(seed) ?? null,
    sessionId: `contract-session-${seed}`,
    kind: harness.kind,
    provider: "contract-provider",
    bucket: "contract-bucket",
    objectKey: `contract/${seed}/original.jpg`,
    publicUrl: `https://cdn.test/contract/${seed}/original.jpg`,
    originalFilename: `${seed}.jpg`,
    mimeType: "image/jpeg",
    size: 4,
    ownerId: harness.actorId ?? null,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
    now,
    metadata: { seed },
  }
}

async function withRepository<
  TAssetId extends MediaId,
  TActorId extends MediaActorId,
  TKind extends string,
>(
  harness: MediaRepositoryContractHarness<TAssetId, TActorId, TKind>,
  task: (repository: MediaRepository<TAssetId, TActorId, TKind>) => Promise<void>
): Promise<void> {
  const repository = await harness.createRepository()

  try {
    await task(repository)
  } finally {
    await harness.cleanupRepository?.(repository)
  }
}

async function createCompletedAsset<
  TAssetId extends MediaId,
  TActorId extends MediaActorId,
  TKind extends string,
>(
  repository: MediaRepository<TAssetId, TActorId, TKind>,
  harness: MediaRepositoryContractHarness<TAssetId, TActorId, TKind>,
  seed: string
): Promise<CompleteUploadResult<TAssetId, TActorId, TKind>> {
  const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
  const created = await repository.createPendingUpload(createPendingInput(harness, seed))
  await repository.claimUploadForProcessing({
    sessionId: created.session.id,
    assetId: created.asset.id,
    now,
  })

  return await repository.completeUpload({
    sessionId: created.session.id,
    assetId: created.asset.id,
    publicUrl: `https://cdn.test/contract/${seed}/original.jpg`,
    checksum: "abc123",
    width: 640,
    height: 480,
    variants: [
      {
        variantType: "thumbnail",
        objectKey: `contract/${seed}/thumbnail.webp`,
        publicUrl: `https://cdn.test/contract/${seed}/thumbnail.webp`,
        width: 150,
        height: 150,
        format: "webp",
        size: 10,
      },
    ],
    now,
  })
}

export function createMediaRepositoryContractSuite<
  TAssetId extends MediaId = MediaId,
  TActorId extends MediaActorId = MediaActorId,
  TKind extends string = MediaAssetKind,
>(
  runner: MediaRepositoryContractRunner,
  harness: MediaRepositoryContractHarness<TAssetId, TActorId, TKind>
): void {
  runner.describe("MediaRepository contract", () => {
    runner.it("creates, finds, and atomically claims pending uploads", async () => {
      await withRepository(harness, async (repository) => {
        const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
        const created = await repository.createPendingUpload(createPendingInput(harness, "claim"))

        assert.equal(created.asset.status, MediaAssetStatus.PENDING_UPLOAD)
        assert.equal(created.session.status, MediaUploadSessionStatus.AWAITING)

        const found = await repository.findUploadSessionWithAsset(created.session.id)
        assert.ok(found)
        assert.equal(found.asset.id, created.asset.id)
        assert.equal(found.session.id, created.session.id)

        assert.equal(
          await repository.claimUploadForProcessing({
            sessionId: created.session.id,
            assetId: created.asset.id,
            now,
          }),
          true
        )
        assert.equal(
          await repository.claimUploadForProcessing({
            sessionId: created.session.id,
            assetId: created.asset.id,
            now,
          }),
          false
        )

        const claimed = await repository.findUploadSessionWithAsset(created.session.id)
        assert.equal(claimed?.asset.status, MediaAssetStatus.PROCESSING)
        assert.equal(claimed?.session.status, MediaUploadSessionStatus.PROCESSING)
      })
    })

    runner.it("completes claimed uploads transactionally with variants", async () => {
      await withRepository(harness, async (repository) => {
        const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
        const created = await repository.createPendingUpload(
          createPendingInput(harness, "complete")
        )
        await repository.claimUploadForProcessing({
          sessionId: created.session.id,
          assetId: created.asset.id,
          now,
        })

        const completed = await repository.completeUpload({
          sessionId: created.session.id,
          assetId: created.asset.id,
          publicUrl: "https://cdn.test/contract/complete/original.jpg",
          checksum: "abc123",
          width: 640,
          height: 480,
          variants: [
            {
              variantType: "thumbnail",
              objectKey: "contract/complete/thumbnail.webp",
              publicUrl: "https://cdn.test/contract/complete/thumbnail.webp",
              width: 150,
              height: 150,
              format: "webp",
              size: 10,
              metadata: { generated: true },
            },
          ],
          now,
        })

        assert.equal(completed.asset.status, MediaAssetStatus.READY)
        assert.equal(completed.asset.checksum, "abc123")
        assert.equal(completed.asset.width, 640)
        assert.equal(completed.variants.length, 1)

        const found = await repository.findUploadSessionWithAsset(created.session.id)
        assert.equal(found?.session.status, MediaUploadSessionStatus.COMPLETED)

        const assetWithVariants = await repository.findAssetWithVariants(created.asset.id)
        assert.equal(assetWithVariants?.asset.status, MediaAssetStatus.READY)
        assert.equal(assetWithVariants?.variants.length, 1)
      })
    })

    runner.it("releases retryable processing claims when implemented", async () => {
      await withRepository(harness, async (repository) => {
        if (!repository.releaseUploadClaim) {
          return
        }

        const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
        const created = await repository.createPendingUpload(createPendingInput(harness, "release"))
        await repository.claimUploadForProcessing({
          sessionId: created.session.id,
          assetId: created.asset.id,
          now,
        })
        await repository.releaseUploadClaim({
          sessionId: created.session.id,
          assetId: created.asset.id,
          now,
        })

        const released = await repository.findUploadSessionWithAsset(created.session.id)
        assert.equal(released?.asset.status, MediaAssetStatus.PENDING_UPLOAD)
        assert.equal(released?.session.status, MediaUploadSessionStatus.AWAITING)
      })
    })

    runner.it("marks failed, expired, cancelled, and deleted states", async () => {
      await withRepository(harness, async (repository) => {
        const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")

        const failed = await repository.createPendingUpload(createPendingInput(harness, "failed"))
        await repository.failUpload({
          sessionId: failed.session.id,
          assetId: failed.asset.id,
          failureReason: "failed",
          now,
        })
        assert.equal(
          (await repository.findUploadSessionWithAsset(failed.session.id))?.asset.status,
          MediaAssetStatus.FAILED
        )

        const expired = await repository.createPendingUpload(createPendingInput(harness, "expired"))
        await repository.expireUpload({
          sessionId: expired.session.id,
          assetId: expired.asset.id,
          failureReason: "expired",
          now,
        })
        assert.equal(
          (await repository.findUploadSessionWithAsset(expired.session.id))?.session.status,
          MediaUploadSessionStatus.EXPIRED
        )

        const cancelled = await repository.createPendingUpload(
          createPendingInput(harness, "cancelled")
        )
        await repository.cancelUpload({
          sessionId: cancelled.session.id,
          assetId: cancelled.asset.id,
          deletionMode: "tombstone",
          now,
        })
        assert.equal(
          (await repository.findUploadSessionWithAsset(cancelled.session.id))?.session.status,
          MediaUploadSessionStatus.CANCELLED
        )

        const deleted = await repository.createPendingUpload(createPendingInput(harness, "deleted"))
        await repository.markAssetDeleted({
          assetId: deleted.asset.id,
          deletionMode: "tombstone",
          now,
        })
        assert.equal(
          (await repository.findAssetWithVariants(deleted.asset.id))?.asset.status,
          MediaAssetStatus.DELETED
        )
      })
    })

    runner.it("updates moved object keys for assets and variants", async () => {
      await withRepository(harness, async (repository) => {
        const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
        const created = await repository.createPendingUpload(createPendingInput(harness, "move"))
        await repository.claimUploadForProcessing({
          sessionId: created.session.id,
          assetId: created.asset.id,
          now,
        })
        const completed = await repository.completeUpload({
          sessionId: created.session.id,
          assetId: created.asset.id,
          publicUrl: "https://cdn.test/contract/move/original.jpg",
          checksum: "abc123",
          width: 640,
          height: 480,
          variants: [
            {
              variantType: "thumbnail",
              objectKey: "contract/move/thumbnail.webp",
              publicUrl: "https://cdn.test/contract/move/thumbnail.webp",
              width: 150,
              height: 150,
              format: "webp",
              size: 10,
            },
          ],
          now,
        })
        const variant = completed.variants[0]
        assert.ok(variant)

        await repository.updateAssetObjectKeys({
          assetId: completed.asset.id,
          objectKey: "moved/original.jpg",
          publicUrl: "https://cdn.test/moved/original.jpg",
          variants: [
            {
              variantId: variant.id,
              objectKey: "moved/thumbnail.webp",
              publicUrl: "https://cdn.test/moved/thumbnail.webp",
            },
          ],
          now,
        })

        const moved = await repository.findAssetWithVariants(completed.asset.id)
        assert.equal(moved?.asset.objectKey, "moved/original.jpg")
        assert.equal(moved?.variants[0]?.objectKey, "moved/thumbnail.webp")
      })
    })

    runner.it("supports transaction callback and session expiry batch", async () => {
      await withRepository(harness, async (repository) => {
        const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")
        const created = await repository.createPendingUpload(createPendingInput(harness, "batch"))
        await repository.markUploadSessionsExpired([created.session.id], now)
        assert.equal(
          (await repository.findUploadSessionWithAsset(created.session.id))?.session.status,
          MediaUploadSessionStatus.EXPIRED
        )

        if (repository.transaction) {
          const value = await repository.transaction(async (transactionRepository) => {
            assert.ok(transactionRepository)
            return 42
          })
          assert.equal(value, 42)
        }
      })
    })

    runner.it(
      "supports optional repository batch update capabilities when implemented",
      async () => {
        await withRepository(harness, async (repository) => {
          const now = harness.now ?? new Date("2026-01-01T00:00:00.000Z")

          if (repository.markAssetsDeleted) {
            const first = await repository.createPendingUpload(
              createPendingInput(harness, "batch-delete-1")
            )
            const second = await repository.createPendingUpload(
              createPendingInput(harness, "batch-delete-2")
            )
            await repository.markAssetsDeleted({
              assetIds: [first.asset.id, second.asset.id],
              deletionMode: "tombstone",
              now,
            })

            assert.equal(
              (await repository.findAssetWithVariants(first.asset.id))?.asset.status,
              MediaAssetStatus.DELETED
            )
            assert.equal(
              (await repository.findAssetWithVariants(second.asset.id))?.asset.status,
              MediaAssetStatus.DELETED
            )
          }

          if (repository.updateAssetObjectKeysBatch) {
            const completed = await createCompletedAsset(repository, harness, "batch-move")
            const variant = completed.variants[0]
            assert.ok(variant)

            await repository.updateAssetObjectKeysBatch({
              updates: [
                {
                  assetId: completed.asset.id,
                  objectKey: "batch-moved/original.jpg",
                  publicUrl: "https://cdn.test/batch-moved/original.jpg",
                  variants: [
                    {
                      variantId: variant.id,
                      objectKey: "batch-moved/thumbnail.webp",
                      publicUrl: "https://cdn.test/batch-moved/thumbnail.webp",
                    },
                  ],
                  now,
                },
              ],
            })

            const moved = await repository.findAssetWithVariants(completed.asset.id)
            assert.equal(moved?.asset.objectKey, "batch-moved/original.jpg")
            assert.equal(moved?.variants[0]?.objectKey, "batch-moved/thumbnail.webp")
          }
        })
      }
    )
  })
}
