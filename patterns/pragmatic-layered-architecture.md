# Pragmatic Layered Architecture

A TypeScript backend feature pattern optimized for **speed + evolvability**: ship features with minimal ceremony today while preserving clean seams for future refactors, extraction, testing, and framework movement.

Use the [`layered-feature-scaffold` skill](../skills/layered-feature-scaffold/SKILL.md) to scaffold feature/domain folders using a pragmatic controller → service → repo layering pattern for TypeScript backends.

## Why this pattern matters

This pattern is the middle path between two expensive extremes:

- **No structure:** fast for a few files, then business rules, HTTP behavior, validation, and database access drift together until reuse and testing become expensive.
- **Heavy architecture too early:** clean in theory, but slows feature work with abstractions before the domain has proven where seams should exist.

Pragmatic Layered Architecture keeps the fast path simple:

- controllers adapt the transport: input, current user, cookies/redirects, error responses
- services own use cases: workflow rules, authorization, and business effects via repos and gateways
- repos isolate ORM and persistence details, including transactions and persistence errors
- domain files hold public types, errors, value objects, and single-type invariants
- each feature exposes one public API — its `index.ts` use cases — to other features
- validation schemas and third-party gateways have predictable homes

The result: small feature files are quick to create, boundaries are easy to enforce, and future refactors can change internals without rewriting controllers or route handlers.

## Reuse

The skill reference contains the rule defining the Pragmatic Layered Architecture, plus the full rationale, examples, transactions, testing guidance, and anti-patterns.

Copy the short rule from the skill reference into the appropriate rules location for your workflow or tooling, such as Cursor rules, CLI-agent rules, or another agent-specific rules folder.

Enforce the import boundaries with the skill's tested ESLint config, [`assets/eslint-boundaries.template.mjs`](../skills/layered-feature-scaffold/assets/eslint-boundaries.template.mjs). See [ADR 0005](../docs/decisions/0005-pragmatic-layered-architecture-v3.md) for what changed in v3.
