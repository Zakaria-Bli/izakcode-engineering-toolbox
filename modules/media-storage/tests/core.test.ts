import { describe, expect, it } from "vitest"

import {
  type CompleteUploadResult,
  createDatePartitionedKeyStrategy,
  createInMemoryCompletionLimiter,
  createMediaStorage,
  createPrefixKeyStrategy,
  type EnqueueObjectDeletionsInput,
  type MediaAsset,
  MediaAssetStatus,
  type MediaAssetVariant,
  type MediaAssetWithVariants,
  type MediaDeletionMode,
  type MediaRepository,
  type MediaUploadRecord,
  type MediaUploadSession,
  MediaUploadSessionStatus,
  type ObjectKeyStrategy,
  type ObjectStorageProvider,
  type StoredObjectMetadata,
} from "../index.js"
import {
  AssetInUseError,
  CapabilityNotSupportedError,
  InvalidMediaRequestError,
  StorageProviderError,
} from "../src/domain/errors.js"
import type { ImageProcessor } from "../src/ports/image-processor.js"
import type {
  CleanupCandidate,
  CleanupQuery,
  CompleteUploadRepositoryInput,
  CreatePendingUploadRepositoryInput,
  UpdateAssetObjectKeysInput,
} from "../src/ports/media-repository.js"
import type {
  CopyObjectInput,
  CreatePresignedPutUrlInput,
  PresignedPutUrlResult,
  PutObjectInput,
} from "../src/ports/storage-provider.js"

type TestAsset = MediaAsset<string, string, string>
type TestVariant = MediaAssetVariant<string>
type TestRecord = MediaUploadRecord<string, string, string>
type TestAssetWithVariants = MediaAssetWithVariants<string, string, string>

const fixedNow = new Date("2026-01-02T03:04:05.000Z")

class FakeStorage implements ObjectStorageProvider {
  readonly name = "fake"
  readonly bucket = "test-bucket"
  readonly objects = new Map<string, { body: Buffer; contentType: string }>()
  readonly deletedKeys: string[] = []
  readonly copiedKeys: { fromKey: string; toKey: string }[] = []
  failCopyToKey: string | null = null

  async createPresignedPutUrl(input: CreatePresignedPutUrlInput): Promise<PresignedPutUrlResult> {
    return {
      uploadUrl: `https://uploads.test/${input.key}`,
      headers: { "Content-Type": input.contentType },
    }
  }

  async headObject(key: string): Promise<StoredObjectMetadata | null> {
    const object = this.objects.get(key)

    if (!object) {
      return null
    }

    return {
      key,
      contentType: object.contentType,
      contentLength: object.body.length,
      eTag: null,
    }
  }

  async createPresignedGetUrl(input: { key: string; expiresInSeconds: number }): Promise<string> {
    return `https://downloads.test/${input.key}?expires=${input.expiresInSeconds}`
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const object = this.objects.get(key)

    if (!object) {
      throw new Error("not found")
    }

    return object.body
  }

  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.key, { body: input.body, contentType: input.contentType })
  }

  async copyObject(input: CopyObjectInput): Promise<void> {
    if (this.failCopyToKey && input.toKey.includes(this.failCopyToKey)) {
      throw new Error("copy failed")
    }

    const object = this.objects.get(input.fromKey)
    if (!object) {
      throw new Error("not found")
    }

    this.objects.set(input.toKey, { ...object })
    this.copiedKeys.push({ fromKey: input.fromKey, toKey: input.toKey })
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.objects.has(key)) {
      const error = new Error("not found")
      error.name = "NotFound"
      throw error
    }

    this.objects.delete(key)
    this.deletedKeys.push(key)
  }

  getPublicUrl(key: string): string {
    return `https://cdn.test/${key}`
  }

  isObjectNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.name === "NotFound"
  }
}

class FlakyReadStorage extends FakeStorage {
  getObjectBufferAttempts = 0

  override async getObjectBuffer(key: string): Promise<Buffer> {
    this.getObjectBufferAttempts += 1

    if (this.getObjectBufferAttempts === 1) {
      throw new StorageProviderError("fake", "getObjectBuffer", new Error("temporary"), { key })
    }

    return await super.getObjectBuffer(key)
  }
}

class StreamingOnlyStorage extends FakeStorage {
  override async getObjectBuffer(): Promise<Buffer> {
    throw new Error("buffer fallback should not be used")
  }

  async getObjectStream(input: { key: string }) {
    const object = this.objects.get(input.key)

    if (!object) {
      throw new Error("not found")
    }

    return {
      body: (async function* streamBody() {
        yield object.body.subarray(0, 2)
        yield object.body.subarray(2)
      })(),
      metadata: {
        key: input.key,
        contentType: object.contentType,
        contentLength: object.body.length,
        eTag: null,
      },
    }
  }
}

class FakeImageProcessor implements ImageProcessor {
  async extractMetadata() {
    return { width: 800, height: 600, format: "jpeg", size: 6 }
  }

  validate(): void {
    // no-op
  }

  async processVariants(input: Parameters<ImageProcessor["processVariants"]>[0]) {
    return input.variants.map((variant) => ({
      variantType: variant.name,
      buffer: Buffer.from(`variant:${variant.name}`),
      width: variant.width,
      height: variant.height ?? variant.width,
      format: variant.format,
      size: Buffer.byteLength(`variant:${variant.name}`),
    }))
  }
}

class FakeRepository implements MediaRepository<string, string, string> {
  readonly assets = new Map<string, TestAsset>()
  readonly sessions = new Map<string, MediaUploadSession<string>>()
  readonly variants = new Map<string, TestVariant[]>()
  cleanupCandidates: CleanupCandidate<string, string, string>[] = []
  transactionCalls = 0
  markAssetsDeletedCalls = 0
  updateAssetObjectKeysBatchCalls = 0
  readonly objectDeletionRequests: EnqueueObjectDeletionsInput<string>["requests"] = []
  nextAssetId = 1
  nextVariantId = 1

  async transaction<T>(
    task: (repository: MediaRepository<string, string, string>) => Promise<T>
  ): Promise<T> {
    this.transactionCalls += 1
    return await task(this)
  }

  async createPendingUpload(
    input: CreatePendingUploadRepositoryInput<string, string, string>
  ): Promise<TestRecord> {
    const assetId = input.assetId ?? `db-asset-${this.nextAssetId++}`
    const asset: TestAsset = {
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

  async findUploadSessionWithAsset(sessionId: string): Promise<TestRecord | null> {
    const session = this.sessions.get(sessionId)
    const asset = session ? this.assets.get(session.assetId) : null
    return session && asset ? { session, asset } : null
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

    if (!asset || !session) throw new Error("missing record")

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
      id: `variant-${this.nextVariantId++}`,
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
    })) satisfies TestVariant[]

    this.variants.set(asset.id, variants)
    return { asset, variants }
  }

  async failUpload(input: {
    sessionId: string
    assetId: string
    failureReason: string
    now: Date
  }): Promise<void> {
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

  async expireUpload(input: {
    sessionId: string
    assetId: string
    failureReason: string
    now: Date
  }): Promise<void> {
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
  }): Promise<void> {
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

  async findAssetWithVariants(assetId: string): Promise<TestAssetWithVariants | null> {
    const asset = this.assets.get(assetId)
    return asset ? { asset, variants: this.variants.get(assetId) ?? [] } : null
  }

  async findAssetsWithVariants(assetIds: string[]): Promise<TestAssetWithVariants[]> {
    return assetIds
      .map((assetId) => this.assets.get(assetId))
      .filter((asset): asset is TestAsset => Boolean(asset))
      .map((asset) => ({ asset, variants: this.variants.get(asset.id) ?? [] }))
  }

  async listAssets() {
    return {
      items: Array.from(this.assets.values()),
      total: this.assets.size,
      page: 1,
      pageSize: 20,
    }
  }

  async markAssetDeleted(input: {
    assetId: string
    deletionMode: MediaDeletionMode
    now: Date
  }): Promise<void> {
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
  }): Promise<void> {
    this.markAssetsDeletedCalls += 1
    for (const assetId of input.assetIds) {
      await this.markAssetDeleted({
        assetId,
        deletionMode: input.deletionMode,
        now: input.now,
      })
    }
  }

  async updateAssetObjectKeys(input: UpdateAssetObjectKeysInput<string>): Promise<void> {
    const asset = this.assets.get(input.assetId)
    if (!asset) throw new Error("missing asset")

    asset.objectKey = input.objectKey
    asset.publicUrl = input.publicUrl
    asset.updatedAt = input.now

    const variants = this.variants.get(input.assetId) ?? []
    for (const variantUpdate of input.variants) {
      const variant = variants.find((entry) => entry.id === variantUpdate.variantId)
      if (variant) {
        variant.objectKey = variantUpdate.objectKey
        variant.publicUrl = variantUpdate.publicUrl
      }
    }
  }

  async updateAssetObjectKeysBatch(input: {
    updates: UpdateAssetObjectKeysInput<string>[]
  }): Promise<void> {
    this.updateAssetObjectKeysBatchCalls += 1
    for (const update of input.updates) {
      await this.updateAssetObjectKeys(update)
    }
  }

  async findCleanupCandidates(
    query: CleanupQuery
  ): Promise<CleanupCandidate<string, string, string>[]> {
    void query
    return this.cleanupCandidates
  }

  async markUploadSessionsExpired(sessionIds: string[], now: Date): Promise<void> {
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)
      if (session) {
        session.status = MediaUploadSessionStatus.EXPIRED
        session.updatedAt = now
      }
    }
  }

  async enqueueObjectDeletions(input: EnqueueObjectDeletionsInput<string>): Promise<void> {
    this.objectDeletionRequests.push(...input.requests)
  }
}

function createHarness(
  options: {
    inUse?: boolean
    keyStrategy?: ObjectKeyStrategy<string>
    objectDeletionMode?: "best-effort" | "outbox"
  } = {}
) {
  let assetCounter = 0
  let sessionCounter = 0
  let nonceCounter = 0
  const repository = new FakeRepository()
  const storage = new FakeStorage()
  const media = createMediaStorage<string, string, string>({
    repository,
    storage,
    imageProcessor: new FakeImageProcessor(),
    keyStrategy: options.keyStrategy ?? createPrefixKeyStrategy({ defaultPrefix: "uploads" }),
    idGenerator: {
      createAssetId: () => `asset-${++assetCounter}`,
      createSessionId: () => `session-${++sessionCounter}`,
      createObjectNonce: () => `nonce-${++nonceCounter}`,
    },
    clock: { now: () => fixedNow },
    limiter: createInMemoryCompletionLimiter({ maxConcurrent: 1, maxQueued: 1 }),
    policies: {
      allowedMimeTypesByKind: { image: ["image/jpeg"] },
      maxSizeByKind: { image: 1024 },
      pathPrefixes: { allowedPrefixes: ["temp", "final", "moved"] },
      uploadSessionTtlMs: 5 * 60 * 1000,
      orphanTtlMs: 24 * 60 * 60 * 1000,
      variants: [{ name: "thumb", width: 100, height: 100, quality: 80, format: "webp" }],
      objectDeletionMode: options.objectDeletionMode ?? "best-effort",
    },
    assetUsagePolicy: () => ({ inUse: options.inUse ?? false, details: { usageCount: 1 } }),
  })

  return { media, repository, storage }
}

async function createUploadedImage(harness = createHarness()) {
  const intent = await harness.media.createUploadIntent({
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    size: 6,
    kind: "image",
    actorId: "actor-1",
    pathPrefix: "temp",
  })
  await harness.storage.putObject({
    key: intent.objectKey,
    body: Buffer.from("source"),
    contentType: "image/jpeg",
  })
  return { ...harness, intent }
}

describe("createMediaStorage", () => {
  it("requires exact upload size enforcement when configured", async () => {
    const strictMedia = createMediaStorage<string, string, string>({
      repository: new FakeRepository(),
      storage: new FakeStorage(),
      imageProcessor: new FakeImageProcessor(),
      keyStrategy: createPrefixKeyStrategy({ defaultPrefix: "uploads" }),
      idGenerator: {
        createAssetId: () => "strict-asset",
        createSessionId: () => "strict-session",
        createObjectNonce: () => "strict-nonce",
      },
      clock: { now: () => fixedNow },
      policies: {
        allowedMimeTypesByKind: { image: ["image/jpeg"] },
        requireExactUploadSizeEnforcement: true,
      },
    })

    await expect(
      strictMedia.createUploadIntent({
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 6,
        kind: "image",
      })
    ).rejects.toBeInstanceOf(CapabilityNotSupportedError)
  })

  it("creates upload intent through repository and storage provider", async () => {
    const { media, repository } = createHarness()

    const intent = await media.createUploadIntent({
      filename: " photo.jpg ",
      mimeType: "image/jpeg",
      size: 6,
      kind: "image",
      actorId: "actor-1",
      pathPrefix: "temp",
    })

    expect(intent.sessionId).toBe("session-1")
    expect(intent.assetId).toBe("asset-1")
    expect(intent.uploadUrl).toContain(intent.objectKey)
    expect(repository.assets.get("asset-1")?.status).toBe(MediaAssetStatus.PENDING_UPLOAD)
  })

  it("completes image upload and writes variants", async () => {
    const harness = await createUploadedImage()

    const result = await harness.media.completeUpload({
      sessionId: harness.intent.sessionId,
      actorId: "actor-1",
    })

    expect(result.asset.status).toBe(MediaAssetStatus.READY)
    expect(result.asset.width).toBe(800)
    expect(result.variants).toHaveLength(1)
    const firstVariant = result.variants[0]
    expect(firstVariant).toBeDefined()
    expect(firstVariant ? harness.storage.objects.has(firstVariant.objectKey) : false).toBe(true)
    expect(harness.repository.sessions.get(harness.intent.sessionId)?.status).toBe(
      MediaUploadSessionStatus.COMPLETED
    )
  })

  it("retries transient storage reads during completion", async () => {
    let assetCounter = 0
    let sessionCounter = 0
    let nonceCounter = 0
    const repository = new FakeRepository()
    const storage = new FlakyReadStorage()
    const media = createMediaStorage<string, string, string>({
      repository,
      storage,
      keyStrategy: createPrefixKeyStrategy({ defaultPrefix: "files" }),
      idGenerator: {
        createAssetId: () => `retry-file-${++assetCounter}`,
        createSessionId: () => `retry-session-${++sessionCounter}`,
        createObjectNonce: () => `retry-nonce-${++nonceCounter}`,
      },
      clock: { now: () => fixedNow },
      retryPolicy: { maxAttempts: 2, initialDelayMs: 0 },
      policies: {
        allowedMimeTypesByKind: { file: ["application/pdf"] },
        maxSizeByKind: { file: 1024 },
      },
    })

    const intent = await media.createUploadIntent({
      filename: "document.pdf",
      mimeType: "application/pdf",
      size: 7,
      kind: "file",
    })
    await storage.putObject({
      key: intent.objectKey,
      body: Buffer.from("pdfdata"),
      contentType: "application/pdf",
    })

    const result = await media.completeUpload({ sessionId: intent.sessionId })

    expect(result.asset.status).toBe(MediaAssetStatus.READY)
    expect(storage.getObjectBufferAttempts).toBe(2)
  })

  it("streams non-image completion without buffering the object", async () => {
    let assetCounter = 0
    let sessionCounter = 0
    let nonceCounter = 0
    const repository = new FakeRepository()
    const storage = new StreamingOnlyStorage()
    const media = createMediaStorage<string, string, string>({
      repository,
      storage,
      keyStrategy: createPrefixKeyStrategy({ defaultPrefix: "files" }),
      idGenerator: {
        createAssetId: () => `file-${++assetCounter}`,
        createSessionId: () => `file-session-${++sessionCounter}`,
        createObjectNonce: () => `file-nonce-${++nonceCounter}`,
      },
      clock: { now: () => fixedNow },
      policies: {
        allowedMimeTypesByKind: { file: ["application/pdf"] },
        maxSizeByKind: { file: 1024 },
      },
    })

    const intent = await media.createUploadIntent({
      filename: "document.pdf",
      mimeType: "application/pdf",
      size: 7,
      kind: "file",
    })
    await storage.putObject({
      key: intent.objectKey,
      body: Buffer.from("pdfdata"),
      contentType: "application/pdf",
    })

    const result = await media.completeUpload({ sessionId: intent.sessionId })

    expect(result.asset.status).toBe(MediaAssetStatus.READY)
    expect(result.asset.checksum).toBe(
      "d23c47e2668cdbc7f204ad3988579fb541ac7ca8abf6038d07236b8a2ba02c1f"
    )
    expect(result.variants).toHaveLength(0)
  })

  it("marks claimed upload failed when stored object metadata mismatches", async () => {
    const harness = createHarness()
    const intent = await harness.media.createUploadIntent({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 6,
      kind: "image",
      pathPrefix: "temp",
    })
    await harness.storage.putObject({
      key: intent.objectKey,
      body: Buffer.from("source"),
      contentType: "image/png",
    })

    await expect(
      harness.media.completeUpload({ sessionId: intent.sessionId })
    ).rejects.toBeInstanceOf(InvalidMediaRequestError)
    expect(harness.repository.assets.get(intent.assetId)?.status).toBe(MediaAssetStatus.FAILED)
  })

  it("enqueues original object deletion when terminal completion fails in outbox mode", async () => {
    const harness = createHarness({ objectDeletionMode: "outbox" })
    const intent = await harness.media.createUploadIntent({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 6,
      kind: "image",
      pathPrefix: "temp",
    })
    await harness.storage.putObject({
      key: intent.objectKey,
      body: Buffer.from("source"),
      contentType: "image/png",
    })

    await expect(
      harness.media.completeUpload({ sessionId: intent.sessionId })
    ).rejects.toBeInstanceOf(InvalidMediaRequestError)

    expect(harness.repository.objectDeletionRequests).toMatchObject([
      {
        objectKey: intent.objectKey,
        reason: "upload_failed",
        assetId: intent.assetId,
        sessionId: intent.sessionId,
      },
    ])
    expect(harness.repository.transactionCalls).toBe(1)
    expect(harness.storage.objects.has(intent.objectKey)).toBe(false)
  })

  it("cancels awaiting upload and deletes original object", async () => {
    const harness = await createUploadedImage()

    await harness.media.cancelUpload({ sessionId: harness.intent.sessionId, actorId: "actor-1" })

    expect(harness.repository.assets.get(harness.intent.assetId)?.status).toBe(
      MediaAssetStatus.DELETED
    )
    expect(harness.repository.sessions.get(harness.intent.sessionId)?.status).toBe(
      MediaUploadSessionStatus.CANCELLED
    )
    expect(harness.storage.objects.has(harness.intent.objectKey)).toBe(false)
  })

  it("enqueues cancelled upload object deletion in outbox mode", async () => {
    const harness = await createUploadedImage(createHarness({ objectDeletionMode: "outbox" }))

    await harness.media.cancelUpload({ sessionId: harness.intent.sessionId, actorId: "actor-1" })

    expect(harness.repository.objectDeletionRequests).toMatchObject([
      {
        objectKey: harness.intent.objectKey,
        reason: "upload_cancelled",
        assetId: harness.intent.assetId,
        sessionId: harness.intent.sessionId,
      },
    ])
    expect(harness.repository.transactionCalls).toBe(1)
    expect(harness.storage.objects.has(harness.intent.objectKey)).toBe(false)
  })

  it("rejects signed download URL expiry beyond policy maximum", async () => {
    const harness = await createUploadedImage()
    await harness.media.completeUpload({ sessionId: harness.intent.sessionId })

    await expect(
      harness.media.getDownloadUrl({
        assetId: harness.intent.assetId,
        expiresInSeconds: 3_601,
      })
    ).rejects.toBeInstanceOf(InvalidMediaRequestError)
  })

  it("blocks delete when usage policy reports asset in use", async () => {
    const harness = await createUploadedImage(createHarness({ inUse: true }))
    await harness.media.completeUpload({ sessionId: harness.intent.sessionId })

    await expect(
      harness.media.deleteAsset({ assetId: harness.intent.assetId })
    ).rejects.toBeInstanceOf(AssetInUseError)
  })

  it("enqueues ready asset object deletion in outbox mode", async () => {
    const harness = await createUploadedImage(createHarness({ objectDeletionMode: "outbox" }))
    const completed = await harness.media.completeUpload({ sessionId: harness.intent.sessionId })

    await harness.media.deleteAsset({ assetId: completed.asset.id })

    expect(harness.repository.objectDeletionRequests).toHaveLength(2)
    expect(harness.repository.objectDeletionRequests.map((request) => request.reason)).toEqual([
      "asset_deleted",
      "asset_deleted",
    ])
    expect(harness.repository.objectDeletionRequests[0]).toMatchObject({
      objectKey: completed.asset.objectKey,
      assetId: completed.asset.id,
    })
    expect(harness.repository.objectDeletionRequests[1]).toMatchObject({
      objectKey: completed.variants[0]?.objectKey,
      assetId: completed.asset.id,
    })
    expect(harness.repository.transactionCalls).toBe(1)
    expect(harness.storage.objects.has(completed.asset.objectKey)).toBe(false)
  })

  it("moves date-partitioned assets to collision-free target keys", async () => {
    const harness = createHarness({ keyStrategy: createDatePartitionedKeyStrategy() })
    const first = await createUploadedImage(harness)
    const firstCompleted = await first.media.completeUpload({ sessionId: first.intent.sessionId })
    const secondIntent = await first.media.createUploadIntent({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 6,
      kind: "image",
      actorId: "actor-1",
      pathPrefix: "temp",
    })
    await first.storage.putObject({
      key: secondIntent.objectKey,
      body: Buffer.from("source"),
      contentType: "image/jpeg",
    })
    const secondCompleted = await first.media.completeUpload({ sessionId: secondIntent.sessionId })

    const result = await first.media.moveAssets({
      assetIds: [firstCompleted.asset.id, secondCompleted.asset.id],
      toPrefix: "moved",
    })

    expect(result.assets.map((asset) => asset.objectKey).sort()).toEqual([
      `moved/${firstCompleted.asset.id}/original.jpg`,
      `moved/${secondCompleted.asset.id}/original.jpg`,
    ])
    expect(first.repository.updateAssetObjectKeysBatchCalls).toBe(1)
  })

  it("rejects move target collisions before copying objects", async () => {
    const harness = await createUploadedImage()
    const completed = await harness.media.completeUpload({ sessionId: harness.intent.sessionId })
    const collidingKeyStrategy: ObjectKeyStrategy<string> = {
      ...createPrefixKeyStrategy({ defaultPrefix: "uploads" }),
      buildMovedObjectKey: () => "moved/same-key.jpg",
    }
    const secondHarness = createHarness({ keyStrategy: collidingKeyStrategy })
    secondHarness.repository.assets.set(completed.asset.id, completed.asset)
    secondHarness.repository.variants.set(completed.asset.id, completed.variants)
    secondHarness.storage.objects.set(
      completed.asset.objectKey,
      harness.storage.objects.get(completed.asset.objectKey) ?? {
        body: Buffer.from("source"),
        contentType: "image/jpeg",
      }
    )
    for (const variant of completed.variants) {
      secondHarness.storage.objects.set(variant.objectKey, {
        body: Buffer.from("variant"),
        contentType: "image/webp",
      })
    }

    await expect(
      secondHarness.media.moveAssets({ assetIds: [completed.asset.id], toPrefix: "moved" })
    ).rejects.toBeInstanceOf(InvalidMediaRequestError)
    expect(secondHarness.storage.copiedKeys).toHaveLength(0)
  })

  it("rolls back copied objects when move fails", async () => {
    const harness = await createUploadedImage()
    const completed = await harness.media.completeUpload({ sessionId: harness.intent.sessionId })
    harness.storage.failCopyToKey = "thumb"

    await expect(
      harness.media.moveAssets({ assetIds: [completed.asset.id], toPrefix: "moved" })
    ).rejects.toThrow("copy failed")

    expect(harness.storage.objects.has("moved/1704164645000-nonce-1-thumb.webp")).toBe(false)
    expect(harness.storage.objects.has("moved/1704164645000-nonce-1.jpg")).toBe(false)
  })

  it("cleans objects and tombstones cleanup candidates", async () => {
    const harness = await createUploadedImage()
    const completed = await harness.media.completeUpload({ sessionId: harness.intent.sessionId })
    harness.repository.cleanupCandidates = [
      {
        ...completed,
        reason: "orphan_asset",
        sessionId: harness.intent.sessionId,
      },
    ]

    const result = await harness.media.cleanup({ limit: 10 })

    expect(result.deletedObjects).toBe(2)
    expect(result.deletedAssets).toBe(1)
    expect(result.expiredSessions).toBe(1)
    expect(harness.repository.markAssetsDeletedCalls).toBe(1)
    expect(harness.repository.assets.get(completed.asset.id)?.status).toBe(MediaAssetStatus.DELETED)
  })
})
