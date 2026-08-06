import { Readable } from "node:stream"

import type { StoredObjectMetadata } from "@toolbox/media-storage/domain"
import type {
  CopyObjectInput,
  CreatePresignedGetUrlInput,
  CreateUploadTargetInput,
  DeleteObjectsResult,
  GetObjectStreamInput,
  GetObjectStreamResult,
  ObjectStorageProvider,
  PutObjectInput,
  UploadTargetResult,
} from "@toolbox/media-storage/ports"
import { assertValidObjectKey, encodeObjectKeyForUrl } from "@toolbox/media-storage/ports"

interface StoredMemoryObject {
  body: Buffer
  contentType: string
  metadata?: Record<string, string> | null
  updatedAt: Date
}

function createNotFoundError(key: string): Error {
  const error = new Error(`Object not found: ${key}`)
  error.name = "ObjectNotFound"
  return error
}

export class MemoryObjectStorageProvider implements ObjectStorageProvider {
  readonly name = "memory"
  readonly bucket = "memory"
  readonly capabilities = {
    uploadTarget: true,
    presignGet: true,
    publicUrl: true,
    copy: true,
    batchDelete: true,
    streamingRead: true,
    exactUploadSize: false,
  }

  private readonly objects = new Map<string, StoredMemoryObject>()

  async createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTargetResult> {
    assertValidObjectKey(input.key)

    return {
      method: "PUT",
      uploadUrl: `memory://upload/${encodeObjectKeyForUrl(input.key)}`,
      headers: { "Content-Type": input.contentType },
    }
  }

  async createPresignedGetUrl(input: CreatePresignedGetUrlInput): Promise<string> {
    assertValidObjectKey(input.key)
    return `memory://download/${encodeObjectKeyForUrl(input.key)}?expires=${input.expiresInSeconds}`
  }

  async headObject(key: string): Promise<StoredObjectMetadata | null> {
    assertValidObjectKey(key)
    const object = this.objects.get(key)

    if (!object) {
      return null
    }

    return {
      key,
      contentType: object.contentType,
      contentLength: object.body.length,
      eTag: null,
      lastModified: object.updatedAt,
      metadata: object.metadata ?? null,
    }
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    assertValidObjectKey(key)
    const object = this.objects.get(key)

    if (!object) {
      throw createNotFoundError(key)
    }

    return Buffer.from(object.body)
  }

  async getObjectStream(input: GetObjectStreamInput): Promise<GetObjectStreamResult> {
    const metadata = await this.headObject(input.key)

    if (!metadata) {
      throw createNotFoundError(input.key)
    }

    return {
      body: Readable.from([await this.getObjectBuffer(input.key)]),
      metadata,
    }
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertValidObjectKey(input.key)
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      metadata: input.metadata ?? null,
      updatedAt: new Date(),
    })
  }

  async copyObject(input: CopyObjectInput): Promise<void> {
    assertValidObjectKey(input.fromKey)
    assertValidObjectKey(input.toKey)
    const object = this.objects.get(input.fromKey)

    if (!object) {
      throw createNotFoundError(input.fromKey)
    }

    this.objects.set(input.toKey, {
      body: Buffer.from(object.body),
      contentType: input.contentType ?? object.contentType,
      metadata: input.metadata ?? object.metadata ?? null,
      updatedAt: new Date(),
    })
  }

  async deleteObject(key: string): Promise<void> {
    assertValidObjectKey(key)

    if (!this.objects.delete(key)) {
      throw createNotFoundError(key)
    }
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    const result: DeleteObjectsResult = { deletedKeys: [], missingKeys: [], failedKeys: [] }

    for (const key of new Set(keys)) {
      try {
        await this.deleteObject(key)
        result.deletedKeys.push(key)
      } catch (error) {
        if (this.isObjectNotFoundError(error)) {
          result.missingKeys.push(key)
        } else {
          result.failedKeys.push({ key, error })
        }
      }
    }

    return result
  }

  getPublicUrl(key: string): string {
    assertValidObjectKey(key)
    return `memory://public/${encodeObjectKeyForUrl(key)}`
  }

  isObjectNotFoundError(error: unknown): boolean {
    return error instanceof Error && error.name === "ObjectNotFound"
  }
}
