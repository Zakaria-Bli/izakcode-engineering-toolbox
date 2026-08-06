import { createHmac, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"

import { StorageProviderError } from "../../domain/errors.js"
import type { StoredObjectMetadata } from "../../domain/types.js"
import {
  assertValidObjectKey,
  decodeObjectKeyFromUrlPath,
  encodeObjectKeyForUrl,
} from "../../ports/object-key-validation.js"
import type {
  CopyObjectInput,
  CreatePresignedPutUrlInput,
  CreateUploadTargetInput,
  DeleteObjectsResult,
  GetObjectStreamInput,
  GetObjectStreamResult,
  ObjectStorageProvider,
  PresignedPutUrlResult,
  PutObjectInput,
  UploadTargetResult,
} from "../../ports/storage-provider.js"

export interface LocalStorageProviderConfig {
  rootDirectory: string
  publicUrl: string
  uploadUrl: string
  signingSecret: string
  now?: () => Date
}

export interface LocalUploadSignatureInput {
  key: string
  expires: number
  contentType: string
  contentLength: number
  signingSecret: string
}

export interface VerifyLocalUploadSignatureInput extends LocalUploadSignatureInput {
  signature: string
  now?: Date
}

export interface LocalUploadVerificationResult {
  ok: boolean
  reason?: "expired" | "invalid"
}

interface LocalObjectMetadataFile {
  contentType: string | null
  contentLength: number | null
  metadata?: Record<string, string> | null
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function normalizePublicUrl(publicUrl: string): string {
  const normalized = trimTrailingSlash(publicUrl.trim())

  if (!normalized) {
    throw new StorageProviderError("local", "initialize", undefined, {
      reason: "publicUrl is required",
    })
  }

  return normalized
}

function appendQuery(url: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString()
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}${search}`
}

function signaturePayload(input: Omit<LocalUploadSignatureInput, "signingSecret">): string {
  return `${input.key}:${input.expires}:${input.contentType}:${input.contentLength}`
}

export function signLocalUpload(input: LocalUploadSignatureInput): string {
  assertValidObjectKey(input.key)

  return createHmac("sha256", input.signingSecret).update(signaturePayload(input)).digest("hex")
}

export function verifyLocalUploadSignature(
  input: VerifyLocalUploadSignatureInput
): LocalUploadVerificationResult {
  if (Math.floor((input.now ?? new Date()).getTime() / 1_000) > input.expires) {
    return { ok: false, reason: "expired" }
  }

  const expected = signLocalUpload(input)

  try {
    const expectedBuffer = Buffer.from(expected, "hex")
    const actualBuffer = Buffer.from(input.signature, "hex")

    if (expectedBuffer.length !== actualBuffer.length) {
      return { ok: false, reason: "invalid" }
    }

    return timingSafeEqual(expectedBuffer, actualBuffer)
      ? { ok: true }
      : { ok: false, reason: "invalid" }
  } catch {
    return { ok: false, reason: "invalid" }
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code === code
  )
}

export function isLocalObjectNotFoundError(error: unknown): boolean {
  if (error instanceof StorageProviderError && error.cause) {
    return isLocalObjectNotFoundError(error.cause)
  }

  return isErrnoCode(error, "ENOENT")
}

export function buildLocalPublicUrl(publicBaseUrl: string, key: string): string {
  return `${normalizePublicUrl(publicBaseUrl)}/${encodeObjectKeyForUrl(key)}`
}

export function extractLocalObjectKeyFromPublicUrl(
  url: string,
  publicBaseUrl: string
): string | null {
  const prefix = `${normalizePublicUrl(publicBaseUrl)}/`

  if (!url.startsWith(prefix)) {
    return null
  }

  return decodeObjectKeyFromUrlPath(url.slice(prefix.length))
}

export class LocalStorageProvider implements ObjectStorageProvider {
  public readonly name = "local"
  public readonly bucket = null
  public readonly capabilities = {
    presignPut: true,
    uploadTarget: true,
    publicUrl: true,
    copy: true,
    batchDelete: true,
    streamingRead: true,
    exactUploadSize: true,
  }

  private readonly rootDirectory: string
  private readonly publicUrl: string
  private readonly uploadUrl: string
  private readonly signingSecret: string
  private readonly now: () => Date

  constructor(config: LocalStorageProviderConfig) {
    if (!config.signingSecret) {
      throw new StorageProviderError("local", "initialize", undefined, {
        reason: "signingSecret is required",
      })
    }

    this.rootDirectory = resolve(config.rootDirectory)
    this.publicUrl = normalizePublicUrl(config.publicUrl)
    this.uploadUrl = config.uploadUrl
    this.signingSecret = config.signingSecret
    this.now = config.now ?? (() => new Date())
  }

  private resolveObjectPath(key: string): string {
    assertValidObjectKey(key)

    const objectPath = resolve(this.rootDirectory, key)

    if (objectPath !== this.rootDirectory && objectPath.startsWith(`${this.rootDirectory}${sep}`)) {
      return objectPath
    }

    throw new StorageProviderError("local", "resolveObjectPath", undefined, {
      key,
      reason: "Object path escapes storage root",
    })
  }

  private resolveMetadataPath(key: string): string {
    return `${this.resolveObjectPath(key)}.__metadata.json`
  }

  private async readMetadata(key: string): Promise<LocalObjectMetadataFile | null> {
    try {
      return JSON.parse(
        await readFile(this.resolveMetadataPath(key), "utf8")
      ) as LocalObjectMetadataFile
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) {
        return null
      }

      throw error
    }
  }

  private async writeMetadataFile(key: string, metadata: LocalObjectMetadataFile): Promise<void> {
    const metadataPath = this.resolveMetadataPath(key)
    await mkdir(dirname(metadataPath), { recursive: true })
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2))
  }

  async createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTargetResult> {
    const presigned = await this.createPresignedPutUrl(input)
    return { method: "PUT", ...presigned }
  }

  async createPresignedPutUrl(input: CreatePresignedPutUrlInput): Promise<PresignedPutUrlResult> {
    assertValidObjectKey(input.key)

    const expires = Math.floor(this.now().getTime() / 1_000) + input.expiresInSeconds
    const signature = signLocalUpload({
      key: input.key,
      expires,
      contentType: input.contentType,
      contentLength: input.contentLength,
      signingSecret: this.signingSecret,
    })

    return {
      uploadUrl: appendQuery(this.uploadUrl, {
        key: input.key,
        expires: String(expires),
        contentType: input.contentType,
        contentLength: String(input.contentLength),
        signature,
      }),
      headers: {
        "Content-Type": input.contentType,
      },
    }
  }

  async headObject(key: string): Promise<StoredObjectMetadata | null> {
    assertValidObjectKey(key)

    try {
      const objectPath = this.resolveObjectPath(key)
      const objectStat = await stat(objectPath)
      const metadata = await this.readMetadata(key)

      return {
        key,
        contentType: metadata?.contentType ?? null,
        contentLength: objectStat.size,
        eTag: null,
        lastModified: objectStat.mtime,
        metadata: metadata?.metadata ?? null,
      }
    } catch (error) {
      if (isLocalObjectNotFoundError(error)) {
        return null
      }

      throw new StorageProviderError("local", "headObject", error, { key })
    }
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    assertValidObjectKey(key)

    try {
      return await readFile(this.resolveObjectPath(key))
    } catch (error) {
      throw new StorageProviderError("local", "getObjectBuffer", error, { key })
    }
  }

  async getObjectStream(input: GetObjectStreamInput): Promise<GetObjectStreamResult> {
    assertValidObjectKey(input.key)

    try {
      const metadata = await this.headObject(input.key)

      if (!metadata) {
        const error = new Error("not found")
        Object.assign(error, { code: "ENOENT" })
        throw error
      }

      return {
        body: createReadStream(this.resolveObjectPath(input.key)),
        metadata,
      }
    } catch (error) {
      throw new StorageProviderError("local", "getObjectStream", error, { key: input.key })
    }
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertValidObjectKey(input.key)

    try {
      const objectPath = this.resolveObjectPath(input.key)
      await mkdir(dirname(objectPath), { recursive: true })
      await writeFile(objectPath, input.body)
      await this.writeMetadataFile(input.key, {
        contentType: input.contentType,
        contentLength: input.body.length,
        metadata: input.metadata ?? null,
      })
    } catch (error) {
      throw new StorageProviderError("local", "putObject", error, { key: input.key })
    }
  }

  async copyObject(input: CopyObjectInput): Promise<void> {
    assertValidObjectKey(input.fromKey)
    assertValidObjectKey(input.toKey)

    if (input.fromKey === input.toKey) {
      return
    }

    try {
      const fromPath = this.resolveObjectPath(input.fromKey)
      const toPath = this.resolveObjectPath(input.toKey)
      await mkdir(dirname(toPath), { recursive: true })
      await copyFile(fromPath, toPath)

      const sourceMetadata = await this.readMetadata(input.fromKey)
      if (sourceMetadata) {
        const bodyStat = await stat(toPath)
        await this.writeMetadataFile(input.toKey, {
          contentType:
            input.contentType ?? sourceMetadata.contentType ?? "application/octet-stream",
          contentLength: bodyStat.size,
          metadata: input.metadata ?? sourceMetadata.metadata ?? null,
        })
      }
    } catch (error) {
      throw new StorageProviderError("local", "copyObject", error, {
        fromKey: input.fromKey,
        toKey: input.toKey,
      })
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertValidObjectKey(key)

    try {
      await rm(this.resolveObjectPath(key), { force: false })
      await rm(this.resolveMetadataPath(key), { force: true })
    } catch (error) {
      throw new StorageProviderError("local", "deleteObject", error, { key })
    }
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    const uniqueKeys = Array.from(new Set(keys.filter(Boolean)))
    const result: DeleteObjectsResult = {
      deletedKeys: [],
      missingKeys: [],
      failedKeys: [],
    }

    for (const key of uniqueKeys) {
      try {
        await this.deleteObject(key)
        result.deletedKeys.push(key)
      } catch (error) {
        if (this.isObjectNotFoundError(error)) {
          result.missingKeys.push(key)
          continue
        }

        result.failedKeys.push({ key, error })
      }
    }

    return result
  }

  getPublicUrl(key: string): string {
    return buildLocalPublicUrl(this.publicUrl, key)
  }

  parsePublicUrl(url: string): string | null {
    return extractLocalObjectKeyFromPublicUrl(url, this.publicUrl)
  }

  isObjectNotFoundError(error: unknown): boolean {
    return isLocalObjectNotFoundError(error)
  }
}

export function createLocalStorageProvider(
  config: LocalStorageProviderConfig
): LocalStorageProvider {
  return new LocalStorageProvider(config)
}
