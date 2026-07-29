# Drizzle Postgres Admin Recipe

Sketch for implementing repositories with Drizzle + Postgres for admin-only auth.

## Tables

```ts
export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export const sessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => admins.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
})

export const authTokens = pgTable("auth_tokens", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => admins.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  email: text("email"), // required for email_verification tokens
  expiresAt: timestamp("expires_at").notNull(),
})
```

## Repository requirements

Implement:

- `users.findByEmail`
- `users.findById`
- `credentials.findByEmail`
- `credentials.updatePasswordHash`
- `sessions.create/findWithUserById/updateExpiry/delete/deleteManyForUser` (persist `createdAt` if using `sessionAbsoluteTtlMs`)
- `tokens.create/delete/consume/deleteManyForUserAndPurpose`
- `repositories.transaction` for password reset and token replacement/create atomicity

## Atomic token consume

Postgres pattern:

```sql
DELETE FROM auth_tokens
WHERE id = $1 AND purpose = $2
RETURNING id, user_id, purpose, email, expires_at;
```

When `userId` is provided, also add `AND user_id = $3`.
Use this for `tokens.consume({ tokenId, purpose, userId })`.

## Token replacement

```sql
DELETE FROM auth_tokens
WHERE user_id = $1 AND purpose = $2;
```

Use this for `tokens.deleteManyForUserAndPurpose(userId, purpose)`.

## Auth composition

```ts
const auth = createAuth<AdminUser, string, AdminRole, AdminPermission>({
  config: {
    emailVerificationTokenTtlMs: 86_400_000,
    passwordResetTokenTtlMs: 3_600_000,
    replaceExistingPasswordResetTokens: true,
    sessionRefreshWindowMs: 300_000,
    sessionTtlMs: 43_200_000,
    sessionAbsoluteTtlMs: 7 * 24 * 60 * 60_000,
  },
  policies,
  ports: {
    // passwordHasher implements verifyDummy, or config supplies dummyPasswordHash.
    passwordHasher,
    tokenGenerator: createNodeTokenGenerator(),
  },
  repositories,
})
```
