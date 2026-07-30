import type { AuthTokenPurpose } from "./types.js"

export function isTokenPurpose<Purpose extends AuthTokenPurpose>(
  value: unknown,
  expected: Purpose
): value is Purpose {
  return value === expected
}
