import { describe, expect, it } from "vitest"

import {
  createNodeTokenGenerator,
  generateSecureToken,
  hashToken,
} from "../src/adapters/node/token-generator.js"

describe("node token generator", () => {
  it("generates non-empty URL-safe tokens", () => {
    const token = generateSecureToken()

    expect(token).toBeTruthy()
    expect(token).toMatch(/^[\w-]+$/)
  })

  it("hashes tokens deterministically without returning the raw token", () => {
    const token = "raw-token"
    const hash = hashToken(token)

    expect(hash).not.toBe(token)
    expect(hash).toBe(hashToken(token))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("creates a TokenGenerator port implementation", () => {
    const tokenGenerator = createNodeTokenGenerator()
    const token = tokenGenerator.generate(32)

    expect(token).toBeTruthy()
    expect(tokenGenerator.hash(token)).toBe(hashToken(token))
  })

  it("rejects unsafe token byte lengths", () => {
    expect(() => generateSecureToken(16)).toThrow(RangeError)
  })
})
