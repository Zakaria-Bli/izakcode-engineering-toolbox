# Environment Variables

Environment variables should be explicit, local to the code that consumes them, and safe to document.

## Rules

- Do not use a repository-root `.env` by default.
- Keep env files closest to their consumer:
  - `modules/<name>/.env.example`
  - `playgrounds/<name>/.env.example`
  - `templates/<name>/.env.example`
- Commit example files only.
- Never commit real secret values.
- Document every required variable in the local `README.md` or `.env.example`.
- Prefer one validation boundary per runnable app or playground when TypeScript code exists.
- Avoid scattered direct `process.env` reads. Centralize them later in an `env.ts` file.

## File naming

Allowed committed examples:

```txt
.env.example
.env.local.example
.env.test.example
.env.production.example
```

Ignored real files:

```txt
.env
.env.local
.env.test
.env.production
```

## Variable naming

Use `UPPER_SNAKE_CASE`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/app"
LOG_LEVEL="info"
```

Public/browser-safe variables must use the framework's required public prefix.
For Next.js, use:

```env
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Secrets must not use public prefixes.

## Example `.env.example`

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/app"

# Optional
LOG_LEVEL="info"

# Public/browser-safe
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Validation

When TypeScript code exists, validate environment variables at one boundary per runnable app or playground.
Use a schema library such as Zod, Valibot, ArkType, or Effect Schema.
For framework-integrated env validation, consider T3 Env packages such as `@t3-oss/env-core` or `@t3-oss/env-nextjs`.

Recommended pattern:

- Create a local `env.ts` near the app entry point.
- Read from `process.env` only in `env.ts`.
- Export a typed `env` object for the rest of the app.
- Fail fast during startup, build, or tests when required variables are missing or invalid.
- Coerce booleans, numbers, URLs, and comma-separated lists explicitly.
- Keep server-only variables separate from public/browser-safe variables.

Large env schemas are acceptable when each variable is explicit and documented. The problem is implicit access, not size.
Keep names clear, mark optional values intentionally, and remove deprecated variables quickly.

## CI

Store CI values in GitHub Secrets or GitHub Variables, not in committed files.

If a CI workflow needs an environment variable, declare it explicitly in that workflow step or job.
