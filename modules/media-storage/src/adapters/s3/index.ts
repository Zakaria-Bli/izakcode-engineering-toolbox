import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"
import { createPresignedPost } from "@aws-sdk/s3-presigned-post"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { StorageProviderError } from "../../domain/errors.js"
import type { StoredObjectMetadata } from "../../domain/types.js"
import {
  assertValidObjectKey,
  decodeObjectKeyFromUrlPath,
  encodeObjectKeyForUrl,
} from "../../ports/object-key-validation.js"
import type {
  CopyObjectInput,
  CreatePresignedGetUrlInput,
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

const MAX_DELETE_OBJECTS_KEYS_PER_REQUEST = 1_000

export interface S3StorageProviderCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type S3UploadObjectOptions = Pick<
  PutObjectCommandInput,
  | "ACL"
  | "CacheControl"
  | "ContentDisposition"
  | "ServerSideEncryption"
  | "SSEKMSKeyId"
  | "StorageClass"
>

export type S3UploadTargetMode = "put" | "post"

type S3PostCondition =
  | ["eq", string, string]
  | ["starts-with", string, string]
  | ["content-length-range", number, number]
  | Record<string, string>

export interface S3PresignedPostOptions {
  fields?: Record<string, string>
  conditions?: S3PostCondition[]
}

export interface S3StorageProviderConfig {
  bucket: string
  publicUrl: string
  region?: string
  endpoint?: string
  internalEndpoint?: string
  credentials?: S3StorageProviderCredentials
  forcePathStyle?: boolean
  client?: S3Client
  presignClient?: S3Client
  /** Deprecated: prefer uploadOptions so headers are represented in signed S3 commands. */
  uploadHeaders?: Record<string, string>
  uploadOptions?: S3UploadObjectOptions
  uploadTargetMode?: S3UploadTargetMode
  presignedPostOptions?: S3PresignedPostOptions
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function normalizePublicUrl(publicUrl: string): string {
  const normalized = trimTrailingSlash(publicUrl.trim())

  if (!normalized) {
    throw new StorageProviderError("s3", "initialize", undefined, {
      reason: "publicUrl is required",
    })
  }

  return normalized
}

function createS3ClientConfig(config: S3StorageProviderConfig, endpoint?: string): S3ClientConfig {
  return {
    endpoint,
    region: config.region ?? "us-east-1",
    credentials: config.credentials,
    forcePathStyle: config.forcePathStyle ?? Boolean(endpoint),
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }
}

function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
}

function chunkKeys(keys: string[]): string[][] {
  const chunks: string[][] = []

  for (let index = 0; index < keys.length; index += MAX_DELETE_OBJECTS_KEYS_PER_REQUEST) {
    chunks.push(keys.slice(index, index + MAX_DELETE_OBJECTS_KEYS_PER_REQUEST))
  }

  return chunks
}

function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null
  }

  const metadata =
    "$metadata" in error && typeof error.$metadata === "object" && error.$metadata !== null
      ? error.$metadata
      : null

  if (metadata && "httpStatusCode" in metadata && typeof metadata.httpStatusCode === "number") {
    return metadata.httpStatusCode
  }

  return null
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null
  }

  if ("name" in error && typeof error.name === "string") {
    return error.name
  }

  if ("Code" in error && typeof error.Code === "string") {
    return error.Code
  }

  if ("code" in error && typeof error.code === "string") {
    return error.code
  }

  return null
}

export function isS3ObjectNotFoundError(error: unknown): boolean {
  if (error instanceof StorageProviderError && error.cause) {
    return isS3ObjectNotFoundError(error.cause)
  }

  const code = getErrorCode(error)?.toLowerCase()

  if (code === "notfound" || code === "nosuchkey" || code === "notfounderror") {
    return true
  }

  return getErrorStatusCode(error) === 404
}

function bodyToAsyncIterable(body: GetObjectCommandOutput["Body"]): AsyncIterable<Uint8Array> {
  if (!body) {
    return (async function* emptyBody() {
      yield* [] as Uint8Array[]
    })()
  }

  if (Symbol.asyncIterator in Object(body)) {
    return body as AsyncIterable<Uint8Array>
  }

  if (typeof body.transformToByteArray === "function") {
    return (async function* byteArrayBody() {
      yield await body.transformToByteArray()
    })()
  }

  return (async function* unsupportedBody() {
    yield Buffer.alloc(0)
  })()
}

async function bodyToBuffer(body: GetObjectCommandOutput["Body"]): Promise<Buffer> {
  const chunks: Buffer[] = []

  for await (const chunk of bodyToAsyncIterable(body)) {
    chunks.push(Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

export function buildS3PublicUrl(publicBaseUrl: string, key: string): string {
  return `${normalizePublicUrl(publicBaseUrl)}/${encodeObjectKeyForUrl(key)}`
}

export function extractS3ObjectKeyFromPublicUrl(url: string, publicBaseUrl: string): string | null {
  const prefix = `${normalizePublicUrl(publicBaseUrl)}/`

  if (!url.startsWith(prefix)) {
    return null
  }

  return decodeObjectKeyFromUrlPath(url.slice(prefix.length))
}

export class S3StorageProvider implements ObjectStorageProvider {
  public readonly name = "s3"
  public readonly bucket: string
  public readonly capabilities: ObjectStorageProvider["capabilities"]

  private readonly client: S3Client
  private readonly presignClient: S3Client
  private readonly publicUrl: string
  private readonly uploadHeaders: Record<string, string>
  private readonly uploadOptions: S3UploadObjectOptions
  private readonly uploadTargetMode: S3UploadTargetMode
  private readonly presignedPostOptions: S3PresignedPostOptions

  constructor(config: S3StorageProviderConfig) {
    if (!config.bucket.trim()) {
      throw new StorageProviderError("s3", "initialize", undefined, {
        reason: "bucket is required",
      })
    }

    this.bucket = config.bucket
    this.publicUrl = normalizePublicUrl(config.publicUrl)
    this.uploadHeaders = config.uploadHeaders ?? {}
    this.uploadOptions = config.uploadOptions ?? {}
    this.uploadTargetMode = config.uploadTargetMode ?? "put"
    this.presignedPostOptions = config.presignedPostOptions ?? {}
    this.capabilities = {
      presignPut: true,
      uploadTarget: true,
      presignGet: true,
      publicUrl: true,
      copy: true,
      batchDelete: true,
      streamingRead: true,
      exactUploadSize: this.uploadTargetMode === "post",
    }
    this.client =
      config.client ??
      new S3Client(createS3ClientConfig(config, config.internalEndpoint ?? config.endpoint))
    this.presignClient =
      config.presignClient ??
      config.client ??
      new S3Client(createS3ClientConfig(config, config.endpoint))
  }

  async createUploadTarget(input: CreateUploadTargetInput): Promise<UploadTargetResult> {
    const method = (input.method ?? this.uploadTargetMode).toLowerCase()

    if (method === "post") {
      return await this.createPresignedPostUploadTarget(input)
    }

    const presigned = await this.createPresignedPutUrl(input)
    return { method: "PUT", ...presigned }
  }

  private buildPresignedPostFields(input: CreateUploadTargetInput): Record<string, string> {
    const fields: Record<string, string> = {
      ...this.presignedPostOptions.fields,
      "Content-Type": input.contentType,
    }

    if (this.uploadOptions.ACL) fields.acl = String(this.uploadOptions.ACL)
    if (this.uploadOptions.CacheControl) fields["Cache-Control"] = this.uploadOptions.CacheControl
    if (this.uploadOptions.ContentDisposition) {
      fields["Content-Disposition"] = this.uploadOptions.ContentDisposition
    }
    if (this.uploadOptions.ServerSideEncryption) {
      fields["x-amz-server-side-encryption"] = this.uploadOptions.ServerSideEncryption
    }
    if (this.uploadOptions.SSEKMSKeyId) {
      fields["x-amz-server-side-encryption-aws-kms-key-id"] = this.uploadOptions.SSEKMSKeyId
    }
    if (this.uploadOptions.StorageClass) {
      fields["x-amz-storage-class"] = this.uploadOptions.StorageClass
    }

    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      fields[`x-amz-meta-${key}`] = value
    }

    return fields
  }

  private buildPresignedPostConditions(
    input: CreateUploadTargetInput,
    fields: Record<string, string>
  ): S3PostCondition[] {
    return [
      ...(this.presignedPostOptions.conditions ?? []),
      ["content-length-range", input.contentLength, input.contentLength],
      ["eq", "$Content-Type", input.contentType],
      ...Object.entries(fields)
        .filter(([field]) => field !== "Content-Type")
        .map(([field, value]) => ({ [field]: value })),
    ]
  }

  private async createPresignedPostUploadTarget(
    input: CreateUploadTargetInput
  ): Promise<UploadTargetResult> {
    assertValidObjectKey(input.key)

    try {
      const fields = this.buildPresignedPostFields(input)
      const conditions = this.buildPresignedPostConditions(input, fields)
      const result = await createPresignedPost(this.presignClient, {
        Bucket: this.bucket,
        Key: input.key,
        Fields: fields,
        Conditions: conditions,
        Expires: input.expiresInSeconds,
      })

      return {
        method: "POST",
        uploadUrl: result.url,
        headers: {},
        fields: result.fields,
      }
    } catch (error) {
      throw new StorageProviderError("s3", "createPresignedPostUploadTarget", error, {
        key: input.key,
      })
    }
  }

  async createPresignedPutUrl(input: CreatePresignedPutUrlInput): Promise<PresignedPutUrlResult> {
    assertValidObjectKey(input.key)

    try {
      const uploadUrl = await getSignedUrl(
        this.presignClient,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
          Metadata: input.metadata,
          ...this.uploadOptions,
        }),
        { expiresIn: input.expiresInSeconds }
      )

      return {
        uploadUrl,
        headers: {
          ...this.uploadHeaders,
          "Content-Type": input.contentType,
        },
      }
    } catch (error) {
      throw new StorageProviderError("s3", "createPresignedPutUrl", error, { key: input.key })
    }
  }

  async createPresignedGetUrl(input: CreatePresignedGetUrlInput): Promise<string> {
    assertValidObjectKey(input.key)

    try {
      return await getSignedUrl(
        this.presignClient,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ResponseContentType: input.responseContentType,
          ResponseContentDisposition: input.responseContentDisposition,
        }),
        { expiresIn: input.expiresInSeconds }
      )
    } catch (error) {
      throw new StorageProviderError("s3", "createPresignedGetUrl", error, { key: input.key })
    }
  }

  async headObject(key: string, signal?: AbortSignal): Promise<StoredObjectMetadata | null> {
    assertValidObjectKey(key)

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: signal }
      )

      return {
        key,
        contentType: response.ContentType ?? null,
        contentLength: response.ContentLength ?? null,
        eTag: response.ETag ?? null,
        lastModified: response.LastModified ?? null,
        metadata: response.Metadata ?? null,
      }
    } catch (error) {
      if (isS3ObjectNotFoundError(error)) {
        return null
      }

      throw new StorageProviderError("s3", "headObject", error, { key })
    }
  }

  async getObjectBuffer(key: string, signal?: AbortSignal): Promise<Buffer> {
    assertValidObjectKey(key)

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
        { abortSignal: signal }
      )

      return await bodyToBuffer(response.Body)
    } catch (error) {
      throw new StorageProviderError("s3", "getObjectBuffer", error, { key })
    }
  }

  async getObjectStream(input: GetObjectStreamInput): Promise<GetObjectStreamResult> {
    assertValidObjectKey(input.key)

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
        }),
        { abortSignal: input.signal }
      )

      return {
        body: bodyToAsyncIterable(response.Body),
        metadata: {
          key: input.key,
          contentType: response.ContentType ?? null,
          contentLength: response.ContentLength ?? null,
          eTag: response.ETag ?? null,
          lastModified: response.LastModified ?? null,
          metadata: response.Metadata ?? null,
        },
      }
    } catch (error) {
      throw new StorageProviderError("s3", "getObjectStream", error, { key: input.key })
    }
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertValidObjectKey(input.key)

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
          ...this.uploadOptions,
        }),
        { abortSignal: input.signal }
      )
    } catch (error) {
      throw new StorageProviderError("s3", "putObject", error, { key: input.key })
    }
  }

  async copyObject(input: CopyObjectInput): Promise<void> {
    assertValidObjectKey(input.fromKey)
    assertValidObjectKey(input.toKey)

    if (input.fromKey === input.toKey) {
      return
    }

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: input.toKey,
          CopySource: encodeCopySource(this.bucket, input.fromKey),
          ContentType: input.contentType,
          Metadata: input.metadata,
          MetadataDirective: input.metadata || input.contentType ? "REPLACE" : undefined,
        }),
        { abortSignal: input.signal }
      )
    } catch (error) {
      throw new StorageProviderError("s3", "copyObject", error, {
        fromKey: input.fromKey,
        toKey: input.toKey,
      })
    }
  }

  async deleteObject(key: string): Promise<void> {
    assertValidObjectKey(key)

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      )
    } catch (error) {
      throw new StorageProviderError("s3", "deleteObject", error, { key })
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
      assertValidObjectKey(key)
    }

    try {
      for (const chunk of chunkKeys(uniqueKeys)) {
        const response = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: chunk.map((Key) => ({ Key })),
              Quiet: false,
            },
          })
        )

        const erroredKeys = new Set(
          response.Errors?.map((entry) => entry.Key).filter(Boolean) as string[]
        )
        result.deletedKeys.push(...chunk.filter((key) => !erroredKeys.has(key)))

        for (const entry of response.Errors ?? []) {
          const key = entry.Key ?? "unknown"
          const code = entry.Code ?? null

          if (code === "NoSuchKey" || code === "NotFound") {
            result.missingKeys.push(key)
            continue
          }

          result.failedKeys.push({
            key,
            error: {
              code,
              message: entry.Message ?? null,
            },
          })
        }
      }

      return result
    } catch (error) {
      throw new StorageProviderError("s3", "deleteObjects", error, { keys: uniqueKeys })
    }
  }

  getPublicUrl(key: string): string {
    return buildS3PublicUrl(this.publicUrl, key)
  }

  parsePublicUrl(url: string): string | null {
    return extractS3ObjectKeyFromPublicUrl(url, this.publicUrl)
  }

  isObjectNotFoundError(error: unknown): boolean {
    return isS3ObjectNotFoundError(error)
  }
}

export function createS3StorageProvider(config: S3StorageProviderConfig): S3StorageProvider {
  return new S3StorageProvider(config)
}
