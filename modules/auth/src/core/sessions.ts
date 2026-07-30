export function createExpiryDate(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs)
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime()
}

export function shouldRefresh(
  expiresAt: Date,
  refreshWindowMs: number,
  now: Date = new Date()
): boolean {
  return expiresAt.getTime() - now.getTime() <= refreshWindowMs
}
