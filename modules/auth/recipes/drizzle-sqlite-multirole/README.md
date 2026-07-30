# Drizzle SQLite Multi-role Recipe

Sketch for implementing repositories with Drizzle + SQLite.

## Tables

```ts
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  role: text("role").notNull(),
  bannedAt: integer("banned_at", { mode: "timestamp" }),
})

export const sessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
})

export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  email: text("email"), // required for email_verification tokens
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
})
```

## Atomic token consume

SQLite supports `RETURNING` in modern versions:

```sql
DELETE FROM auth_tokens
WHERE id = ? AND purpose = ?
RETURNING id, user_id, purpose, email, expires_at;
```

When `userId` is provided, also add `AND user_id = ?`.
If your SQLite target lacks `RETURNING`, implement `consume` with a transaction that locks/serializes token lookup and delete.

## Registration

```ts
const register = createRegistrationService<User, string, { displayName?: string }>({
  // passwordHasher implements verifyDummy, or auth config supplies dummyPasswordHash.
  passwordHasher,
  createUser: async ({ email, passwordHash }) => {
    return db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email,
        passwordHash,
        role: "customer",
      })
      .returning()
      .get()
  },
  createSession: auth.createSession,
  requestEmailVerification: auth.requestEmailVerification,
  transaction: async (work) => db.transaction(() => work()),
})
```

## Notes

- Use text ids if sharing with web/mobile clients.
- Store dates consistently as timestamps.
- Implement `repositories.transaction` with SQLite transactions for password reset and token replacement/create atomicity.
- Persist `sessions.createdAt` when using `sessionAbsoluteTtlMs`.
- Add indexes on `sessions.userId`, `authTokens.userId`, and `(authTokens.userId, authTokens.purpose)`.
