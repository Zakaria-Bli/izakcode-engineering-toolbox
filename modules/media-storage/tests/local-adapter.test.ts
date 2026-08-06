import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  createLocalStorageProvider,
  signLocalUpload,
  verifyLocalUploadSignature,
} from "../src/adapters/local/index.js"
import { InvalidObjectKeyError } from "../src/domain/errors.js"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "media-storage-local-"))
  tempDirs.push(dir)
  return dir
}

describe("LocalStorageProvider", () => {
  it("signs and verifies local upload URLs", () => {
    const signature = signLocalUpload({
      key: "temp/file.jpg",
      expires: 2_000_000_000,
      contentType: "image/jpeg",
      contentLength: 12,
      signingSecret: "secret",
    })

    expect(
      verifyLocalUploadSignature({
        key: "temp/file.jpg",
        expires: 2_000_000_000,
        contentType: "image/jpeg",
        contentLength: 12,
        signingSecret: "secret",
        signature,
        now: new Date("2026-01-01T00:00:00.000Z"),
      })
    ).toEqual({ ok: true })
  })

  it("rejects expired local upload signatures", () => {
    const signature = signLocalUpload({
      key: "temp/file.jpg",
      expires: 1,
      contentType: "image/jpeg",
      contentLength: 12,
      signingSecret: "secret",
    })

    expect(
      verifyLocalUploadSignature({
        key: "temp/file.jpg",
        expires: 1,
        contentType: "image/jpeg",
        contentLength: 12,
        signingSecret: "secret",
        signature,
        now: new Date("2026-01-01T00:00:00.000Z"),
      })
    ).toEqual({ ok: false, reason: "expired" })
  })

  it("stores, reads, copies, parses URL, and deletes objects", async () => {
    const rootDirectory = await createTempDir()
    const storage = createLocalStorageProvider({
      rootDirectory,
      publicUrl: "http://localhost:3000/uploads",
      uploadUrl: "http://localhost:3000/api/uploads/put",
      signingSecret: "secret",
    })

    await storage.putObject({
      key: "temp/file.jpg",
      body: Buffer.from("hello"),
      contentType: "image/jpeg",
    })

    expect(await storage.getObjectBuffer("temp/file.jpg")).toEqual(Buffer.from("hello"))
    expect(await storage.headObject("temp/file.jpg")).toMatchObject({
      contentType: "image/jpeg",
      contentLength: 5,
    })

    await storage.copyObject({ fromKey: "temp/file.jpg", toKey: "final/file.jpg" })
    expect(storage.parsePublicUrl("http://localhost:3000/uploads/final/file.jpg")).toBe(
      "final/file.jpg"
    )

    await storage.putObject({
      key: "temp/file name.jpg",
      body: Buffer.from("hello"),
      contentType: "image/jpeg",
    })
    expect(storage.getPublicUrl("temp/file name.jpg")).toBe(
      "http://localhost:3000/uploads/temp/file%20name.jpg"
    )
    expect(storage.parsePublicUrl("http://localhost:3000/uploads/temp/file%20name.jpg")).toBe(
      "temp/file name.jpg"
    )

    await storage.deleteObject("temp/file.jpg")
    expect(await storage.headObject("temp/file.jpg")).toBeNull()
  })

  it("rejects traversal object keys", async () => {
    const rootDirectory = await createTempDir()
    const storage = createLocalStorageProvider({
      rootDirectory,
      publicUrl: "http://localhost:3000/uploads",
      uploadUrl: "http://localhost:3000/api/uploads/put",
      signingSecret: "secret",
    })

    await expect(
      storage.putObject({
        key: "../escape.jpg",
        body: Buffer.from("bad"),
        contentType: "image/jpeg",
      })
    ).rejects.toBeInstanceOf(InvalidObjectKeyError)
  })
})
