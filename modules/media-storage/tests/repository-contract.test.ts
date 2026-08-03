import { describe, it } from "vitest"

import {
  type CompleteUploadResult,
  type ListAssetsFilters,
  type MediaAsset,
  MediaAssetStatus,
  type MediaAssetVariant,
  type MediaDeletionMode,
  type MediaRepository,
  type MediaUploadRecord,
  type MediaUploadSession,
  MediaUploadSessionStatus,
  type Page,
} from "../index.js"
import type {
  CleanupCandidate,
  CleanupQuery,
  CompleteUploadRepositoryInput,
  CreatePendingUploadRepositoryInput,
  UpdateAssetObjectKeysInput,
} from "../src/ports/media-repository.js"
import { createMediaRepositoryContractSuite } from "../src/testing/index.js"

type ContractAsset = MediaAsset<string, string, string>
type ContractVariant = MediaAssetVariant<string>
type ContractRecord = MediaUploadRecord<string, string, string>

class MemoryContractRepository implements MediaRepository<string, string, string> {
  private readonly assets = new Map<string, ContractAsset>()
  private readonly sessions = new Map<string, MediaUploadSession<string>>()
  private readonly variants = new Map<string, ContractVariant[]>()
  private nextAssetId = 1
  private nextVariantId = 1

  async transaction<T>(
    task: (repository: MediaRepository<string, string, string>) => Promise<T>
  ): Promise<T> {
    return await task(this)
  }

  async createPendingUpload(
    input: CreatePendingUploadRepositoryInput<string, string, string>
  ): Promise<ContractRecord> {
    const assetId = input.assetId ?? `contract-db-asset-${this.nextAssetId++}`
    const asset: ContractAsset = {
      id: assetId,
      kind: input.kind,
      status: MediaAssetStatus.PENDING_UPLOAD,
      provider: input.provider,
      bucket: input.bucket,
      objectKey: input.objectKey,
      publicUrl: input.publicUrl,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      size: input.size,
      checksum: null,
      width: null,
      height: null,
      ownerId: input.ownerId,
      failureReason: null,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
      metadata: input.metadata,
    }
    const session: MediaUploadSession<string> = {
      id: input.sessionId,
      assetId,
      expectedMime: input.mimeType,
      expectedSize: input.size,
      objectKey: input.objectKey,
      expiresAt: input.expiresAt,
      status: MediaUploadSessionStatus.AWAITING,
      createdAt: input.now,
      updatedAt: input.now,
      completedAt: null,
    }

    this.assets.set(asset.id, asset)
    this.sessions.set(session.id, session)
    this.variants.set(asset.id, [])
    return { asset, session }
  }

  async findUploadSessionWithAsset(sessionId: string): Promise<ContractRecord | null> {
    const session = this.sessions.get(sessionId)
    const asset = session ? this.assets.get(session.assetId) : null
    return session && asset ? { asset, session } : null
  }

  async claimUploadForProcessing(input: {
    sessionId: string
    assetId: string
    now: Date
  }): Promise<boolean> {
    const session = this.sessions.get(input.sessionId)
    const asset = this.assets.get(input.assetId)

    if (!session || !asset) return false
    if (session.status !== MediaUploadSessionStatus.AWAITING) return false
    if (asset.status !== MediaAssetStatus.PENDING_UPLOAD) return false

    session.status = MediaUploadSessionStatus.PROCESSING
    session.updatedAt = input.now
    asset.status = MediaAssetStatus.PROCESSING
    asset.updatedAt = input.now
    return true
  }

  async completeUpload(
    input: CompleteUploadRepositoryInput<string>
  ): Promise<CompleteUploadResult<string, string, string>> {
    const asset = this.assets.get(input.assetId)
    const session = this.sessions.get(input.sessionId)
    if (!asset || !session) throw new Error("missing upload")

    asset.status = MediaAssetStatus.READY
    asset.publicUrl = input.publicUrl
    asset.checksum = input.checksum
    asset.width = input.width
    asset.height = input.height
    asset.updatedAt = input.now
    session.status = MediaUploadSessionStatus.COMPLETED
    session.completedAt = input.now
    session.updatedAt = input.now

    const variants = input.variants.map((variant) => ({
      id: `contract-variant-${this.nextVariantId++}`,
      assetId: asset.id,
      variantType: variant.variantType,
      objectKey: variant.objectKey,
      publicUrl: variant.publicUrl,
      width: variant.width,
      height: variant.height,
      format: variant.format,
      size: variant.size,
      createdAt: input.now,
      metadata: variant.metadata,
    })) satisfies ContractVariant[]
    this.variants.set(asset.id, variants)

    return { asset, variants }
  }

  async failUpload(input: {
    sessionId: string
    assetId: string
    failureReason: string
    now: Date
  }) {
    const asset = this.assets.get(input.assetId)
    const session = this.sessions.get(input.sessionId)
    if (asset) {
      asset.status = MediaAssetStatus.FAILED
      asset.failureReason = input.failureReason
      asset.updatedAt = input.now
    }
    if (session) {
      session.status = MediaUploadSessionStatus.FAILED
      session.updatedAt = input.now
    }
  }

  async releaseUploadClaim(input: { sessionId: string; assetId: string; now: Date }) {
    const asset = this.assets.get(input.assetId)
    const session = this.sessions.get(input.sessionId)
    if (asset?.status === MediaAssetStatus.PROCESSING) {
      asset.status = MediaAssetStatus.PENDING_UPLOAD
      asset.updatedAt = input.now
    }
    if (session?.status === MediaUploadSessionStatus.PROCESSING) {
      session.status = MediaUploadSessionStatus.AWAITING
      session.updatedAt = input.now
    }
  }

  async expireUpload(input: {
    sessionId: string
    assetId: string
    failureReason: string
    now: Date
  }) {
    const asset = this.assets.get(input.assetId)
    const session = this.sessions.get(input.sessionId)
    if (asset) {
      asset.status = MediaAssetStatus.FAILED
      asset.failureReason = input.failureReason
      asset.updatedAt = input.now
    }
    if (session) {
      session.status = MediaUploadSessionStatus.EXPIRED
      session.updatedAt = input.now
    }
  }

  async cancelUpload(input: {
    sessionId: string
    assetId: string
    deletionMode: MediaDeletionMode
    now: Date
  }) {
    const asset = this.assets.get(input.assetId)
    const session = this.sessions.get(input.sessionId)
    if (asset) {
      asset.status = MediaAssetStatus.DELETED
      asset.deletedAt = input.now
      asset.updatedAt = input.now
    }
    if (session) {
      session.status = MediaUploadSessionStatus.CANCELLED
      session.updatedAt = input.now
    }
  }

  async findAssetWithVariants(assetId: string) {
    const asset = this.assets.get(assetId)
    return asset ? { asset, variants: this.variants.get(assetId) ?? [] } : null
  }

  async findAssetsWithVariants(assetIds: string[]) {
    return assetIds
      .map((assetId) => this.assets.get(assetId))
      .filter((asset): asset is ContractAsset => Boolean(asset))
      .map((asset) => ({ asset, variants: this.variants.get(asset.id) ?? [] }))
  }

  async listAssets(filters: ListAssetsFilters): Promise<Page<ContractAsset>> {
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    let items = Array.from(this.assets.values())
    if (filters.status) items = items.filter((asset) => asset.status === filters.status)
    if (filters.kind) items = items.filter((asset) => asset.kind === filters.kind)

    return {
      items: items.slice((page - 1) * pageSize, page * pageSize),
      total: items.length,
      page,
      pageSize,
    }
  }

  async markAssetDeleted(input: { assetId: string; deletionMode: MediaDeletionMode; now: Date }) {
    const asset = this.assets.get(input.assetId)
    if (!asset) return
    asset.status = MediaAssetStatus.DELETED
    asset.deletedAt = input.now
    asset.updatedAt = input.now
  }

  async markAssetsDeleted(input: {
    assetIds: string[]
    deletionMode: MediaDeletionMode
    now: Date
  }) {
    for (const assetId of input.assetIds) {
      await this.markAssetDeleted({
        assetId,
        deletionMode: input.deletionMode,
        now: input.now,
      })
    }
  }

  async updateAssetObjectKeys(input: UpdateAssetObjectKeysInput<string>) {
    const asset = this.assets.get(input.assetId)
    if (!asset) throw new Error("missing asset")
    asset.objectKey = input.objectKey
    asset.publicUrl = input.publicUrl
    asset.updatedAt = input.now

    const variants = this.variants.get(input.assetId) ?? []
    for (const update of input.variants) {
      const variant = variants.find((entry) => entry.id === update.variantId)
      if (variant) {
        variant.objectKey = update.objectKey
        variant.publicUrl = update.publicUrl
      }
    }
  }

  async updateAssetObjectKeysBatch(input: { updates: UpdateAssetObjectKeysInput<string>[] }) {
    for (const update of input.updates) {
      await this.updateAssetObjectKeys(update)
    }
  }

  async findCleanupCandidates(
    query: CleanupQuery
  ): Promise<CleanupCandidate<string, string, string>[]> {
    void query
    return []
  }

  async markUploadSessionsExpired(sessionIds: string[], now: Date) {
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)
      if (session) {
        session.status = MediaUploadSessionStatus.EXPIRED
        session.updatedAt = now
      }
    }
  }
}

createMediaRepositoryContractSuite(
  { describe, it },
  {
    createRepository: () => new MemoryContractRepository(),
    kind: "image",
    actorId: "actor-1",
    createAssetId: (seed: string) => `contract-asset-${seed}`,
  }
)
