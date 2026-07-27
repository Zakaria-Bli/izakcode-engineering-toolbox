# Auth Tests

Run:

```sh
pnpm --filter @toolbox/auth test
pnpm --filter @toolbox/auth typecheck
pnpm --filter @toolbox/auth lint
```

## Test files

- `core.test.ts` — sign-in, sessions, absolute/sliding expiry, permissions, verification, password reset, token replacement, mailer failure compensation, session invalidation correctness.
- `registration.test.ts` — registration orchestration, rollback, validation, best-effort verification failure.
- `registration-types.test.ts` — compile-time registration generic ergonomics.
- `express-adapter.test.ts` — Express-like cookies, bearer token parsing/source tracking, auth guards, permissions, origin enforcement.
- `next-adapter.test.ts` — Next-like cookie store, current user, refresh, auth guards, origin enforcement, sign-out.
- `node-token-generator.test.ts` — Node token generation, byte-length validation, and hashing.
- `exports.test.ts` — package subpath export smoke test.
- `support/in-memory-auth.ts` — in-memory repositories and ports used by tests.

## Type tests

`registration-types.test.ts` uses `expectTypeOf` and `@ts-expect-error`. It validates type behavior during `tsc --noEmit`, not just during Vitest runtime.
