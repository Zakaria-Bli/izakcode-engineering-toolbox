# Auth Examples

Examples here show composition-root usage. They avoid framework/database-specific imports unless an example says otherwise.

## Direct Node token injection

```ts
import { createAuth } from "@toolbox/auth/core"
import { createNodeTokenGenerator } from "@toolbox/auth/adapters/node/token-generator"

export const auth = createAuth({
  // config includes TTLs, optional sessionAbsoluteTtlMs, and no unsafe opt-outs.
  config,
  policies,
  // repositories implements atomic tokens.consume and transaction for password reset.
  repositories,
  ports: {
    // passwordHasher implements verifyDummy, or config supplies dummyPasswordHash.
    passwordHasher,
    tokenGenerator: createNodeTokenGenerator(),
  },
})
```

## Registration service composition

```ts
import { createRegistrationService } from "@toolbox/auth/services"

export const registerWithPassword = createRegistrationService({
  passwordHasher,
  createUser,
  saveCredential,
  createSession: auth.createSession,
  requestEmailVerification: auth.requestEmailVerification,
  transaction,
  validateInput,
})
```

## Express adapter composition

```ts
import { createExpressAuthAdapter } from "@toolbox/auth/adapters/express"

export const expressAuth = createExpressAuthAdapter({
  auth,
  cookieName: "session",
  cookieOptions: {
    secure: true,
  },
  sessionTtlMs: config.sessionTtlMs,
  trustedOrigins: ["https://app.example.com"],
})
```

## Next adapter composition

```ts
import { cookies } from "next/headers"
import { createNextAuthAdapter } from "@toolbox/auth/adapters/next"

export const nextAuth = createNextAuthAdapter({
  auth,
  cookieName: "session",
  cookieOptions: {
    secure: true,
  },
  getCookieStore: cookies,
  sessionTtlMs: config.sessionTtlMs,
  trustedOrigins: ["https://app.example.com"],
})
```
