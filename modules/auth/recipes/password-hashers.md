# Password Hasher Recipes

Auth finale depends on the `PasswordHasher` port:

```ts
export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(passwordHash: string, password: string): Promise<boolean>
  verifyDummy?(password: string): Promise<void>
}
```

## Argon2 example

```ts
import argon2 from "argon2"

export const passwordHasher = {
  hash: (password: string) => argon2.hash(password),
  verify: (passwordHash: string, password: string) => argon2.verify(passwordHash, password),
  verifyDummy: async (password: string) => {
    await argon2.verify(process.env.DUMMY_PASSWORD_HASH, password)
  },
}
```

## bcrypt example

```ts
import bcrypt from "bcryptjs"

export const passwordHasher = {
  hash: (password: string) => bcrypt.hash(password, 12),
  verify: (passwordHash: string, password: string) => bcrypt.compare(password, passwordHash),
  verifyDummy: async (password: string) => {
    await bcrypt.compare(password, process.env.DUMMY_PASSWORD_HASH)
  },
}
```

## Test hasher

```ts
export const testPasswordHasher = {
  hash: async (password: string) => `hash:${password}`,
  verify: async (passwordHash: string, password: string) => passwordHash === `hash:${password}`,
  verifyDummy: async () => {},
}
```

## Dummy verification

`verifyDummy()` reduces user-enumeration timing differences when sign-in email is missing.

If `verifyDummy` is omitted, core can use `config.dummyPasswordHash` and call `verify(dummyPasswordHash, password)`. Auth construction fails without one of these.

## Recommendations

- Use Argon2id where available.
- Tune memory/time cost per runtime.
- Store a production dummy password hash in env/config.
- Never log plain passwords.
