import { InvalidObjectKeyError } from "../domain/errors.js"

export const MAX_OBJECT_KEY_BYTES = 1_024

export function assertValidObjectKey(key: string): void {
  const segments = key.split("/")
  const byteLength = Buffer.byteLength(key)

  if (!key || byteLength > MAX_OBJECT_KEY_BYTES) {
    throw new InvalidObjectKeyError(key, {
      byteLength,
      maxBytes: MAX_OBJECT_KEY_BYTES,
      reason: "Object key length is invalid.",
    })
  }

  if (
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    key.includes("//") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new InvalidObjectKeyError(key)
  }
}

export function encodeObjectKeyForUrl(key: string): string {
  assertValidObjectKey(key)
  return key.split("/").map(encodeURIComponent).join("/")
}

export function decodeObjectKeyFromUrlPath(path: string): string {
  const key = path
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/")
  assertValidObjectKey(key)
  return key
}
