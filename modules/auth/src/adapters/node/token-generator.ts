import { createHash, randomBytes } from "node:crypto"

import type { TokenGenerator } from "../../ports/ports.js"

const DEFAULT_TOKEN_BYTE_LENGTH = 32
const MIN_TOKEN_BYTE_LENGTH = 32

/** Generates a cryptographically secure URL-safe token using Node.js crypto. */
export function generateSecureToken(byteLength: number = DEFAULT_TOKEN_BYTE_LENGTH): string {
  if (!Number.isInteger(byteLength) || byteLength < MIN_TOKEN_BYTE_LENGTH) {
    throw new RangeError(
      `Token byte length must be an integer of at least ${MIN_TOKEN_BYTE_LENGTH}.`
    )
  }

  return randomBytes(byteLength).toString("base64url")
}

/** Hashes a raw token for safe persistence and lookup. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Creates a Node.js-backed TokenGenerator port implementation. */
export function createNodeTokenGenerator(): TokenGenerator {
  return {
    generate: generateSecureToken,
    hash: hashToken,
  }
}
