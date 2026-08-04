import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createS3StorageProvider } from "../src/adapters/s3/index.js"

const runIntegration = process.env.MEDIA_STORAGE_S3_INTEGRATION === "1"
const describeIntegration = runIntegration ? describe : describe.skip

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value === "1" || value.toLowerCase() === "true"
}

function createBucketName(): string {
  const prefix = env("MEDIA_STORAGE_S3_BUCKET_PREFIX", "media-storage-it")
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase()
}

async function deleteAllObjects(client: S3Client, bucket: string): Promise<void> {
  while (true) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }))
    const keys = listed.Contents?.map((entry) => entry.Key).filter(Boolean) as string[] | undefined

    if (!keys?.length) {
      return
    }

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
        },
      })
    )
  }
}

describeIntegration("S3-compatible integration", () => {
  const endpoint = env("MEDIA_STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
  const region = env("MEDIA_STORAGE_S3_REGION", "us-east-1")
  const accessKeyId = env("MEDIA_STORAGE_S3_ACCESS_KEY_ID", "minioadmin")
  const secretAccessKey = env("MEDIA_STORAGE_S3_SECRET_ACCESS_KEY", "minioadmin")
  const forcePathStyle = boolEnv("MEDIA_STORAGE_S3_FORCE_PATH_STYLE", true)
  const bucket = createBucketName()
  const publicUrl = env("MEDIA_STORAGE_S3_PUBLIC_URL", `${endpoint}/${bucket}`).replace(
    "{bucket}",
    bucket
  )
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
  })
  const storage = createS3StorageProvider({
    bucket,
    publicUrl,
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
    client,
    presignClient: client,
    uploadTargetMode: "post",
  })

  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
  }, 30_000)

  afterAll(async () => {
    await deleteAllObjects(client, bucket).catch(() => undefined)
    await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined)
    client.destroy()
  }, 30_000)

  it("stores, reads, streams, signs, copies, parses URLs, and deletes objects", async () => {
    await storage.putObject({
      key: "uploads/original.txt",
      body: Buffer.from("hello s3 compatible storage"),
      contentType: "text/plain",
      metadata: { source: "integration" },
    })

    await expect(storage.headObject("uploads/original.txt")).resolves.toMatchObject({
      key: "uploads/original.txt",
      contentType: "text/plain",
      contentLength: 27,
      metadata: { source: "integration" },
    })

    await expect(storage.getObjectBuffer("uploads/original.txt")).resolves.toEqual(
      Buffer.from("hello s3 compatible storage")
    )

    const streamed = await storage.getObjectStream({ key: "uploads/original.txt" })
    const chunks: Buffer[] = []
    for await (const chunk of streamed.body) {
      chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from("hello s3 compatible storage"))

    const signedGetUrl = await storage.createPresignedGetUrl({
      key: "uploads/original.txt",
      expiresInSeconds: 60,
    })
    const signedResponse = await fetch(signedGetUrl)
    expect(signedResponse.status).toBe(200)
    expect(await signedResponse.text()).toBe("hello s3 compatible storage")

    const uploadTarget = await storage.createUploadTarget({
      key: "uploads/post-target.txt",
      contentType: "text/plain",
      contentLength: 11,
      expiresInSeconds: 60,
    })
    expect(uploadTarget.method).toBe("POST")
    expect(uploadTarget.fields).toBeDefined()

    await storage.copyObject({ fromKey: "uploads/original.txt", toKey: "uploads/copied.txt" })
    await expect(storage.getObjectBuffer("uploads/copied.txt")).resolves.toEqual(
      Buffer.from("hello s3 compatible storage")
    )

    const publicObjectUrl = storage.getPublicUrl("uploads/file name.txt")
    expect(publicObjectUrl).toContain("uploads/file%20name.txt")
    expect(storage.parsePublicUrl(publicObjectUrl)).toBe("uploads/file name.txt")

    const deleteResult = await storage.deleteObjects([
      "uploads/original.txt",
      "uploads/copied.txt",
      "uploads/post-target.txt",
    ])
    expect(deleteResult.failedKeys).toEqual([])
    await expect(storage.headObject("uploads/original.txt")).resolves.toBeNull()
  }, 30_000)
})
