# Contributing

This repository is a personal engineering toolbox for reusable modules, patterns, templates, and tooling.
The default reuse model is copy-and-adapt, not package publication.

## Workflow

1. Create a branch using the required naming convention.
2. Make a focused change.
3. Run validation locally.
4. Open a pull request using the PR template.

## Branch names

Use:

```txt
type/scope-description
```

Allowed types:

```txt
feat, fix, style, refactor, chore, test, build, ci, infra, docs, perf
```

Examples:

```txt
feat/auth-module
infra/code-quality-setup
docs/environment-conventions
```

## Commits

Use Conventional Commits with a non-empty scope:

```txt
type(scope): summary
```

Examples:

```txt
feat(auth): add session blueprint
infra(repo): configure ci
```

The `infra` type is allowed for repository infrastructure and tooling work.

## Validation

Run before opening a pull request:

```bash
pnpm validate
```

This runs linting, type checks, tests, and formatting checks.

Useful commands:

```bash
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm test
pnpm format:check
pnpm format
pnpm audit:dependencies
```

## Dependencies

Avoid unnecessary dependencies. Add a dependency only when it supports a reusable module, template, playground, or shared tooling need.

When adding a dependency, document why it is needed and whether it belongs to:

- root repository tooling
- a shared tooling package
- a playground
- a future template
- a module that may later become a package

## Environment variables

Do not commit real env files or secrets.
Commit `.env.example` files only.

Follow:

```txt
docs/principles/environment.md
```

## Documentation

Update documentation when a change affects:

- reuse assumptions
- module limitations
- template setup steps
- environment variables
- architectural decisions
- developer commands

## Pull requests

Keep pull requests focused and reviewable. Include testing steps and call out any assumptions that future copy-and-adapt users need to know.
