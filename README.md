# iZakCode Engineering Toolbox

A personal engineering workspace for developing, documenting, validating,
and evolving reusable modules, patterns, templates, skills, and tooling.

## Purpose

This repository collects engineering assets that repeatedly appear across
projects. Most modules begin as copy-and-adapt blueprints. Selected modules
may later evolve into stable reusable packages after their boundaries and
APIs have been validated across real projects.

## Repository areas

- `modules/` — substantial reusable implementations
- `patterns/` — documented architectural and implementation approaches
- `snippets/` — small reusable code fragments and examples
- `templates/` — project and feature starters
- `skills/` — reusable agent skills and workflow instructions (see `skills/README.md`)
- `playgrounds/` — runnable integration and experimentation environments
- `tooling/` — shared development configuration and repository tooling
- `scripts/` — repository maintenance and automation scripts
- `docs/principles/` — engineering principles and conventions
- `docs/decisions/` — architecture decision records

## Reuse model

The default reuse model is **copy and adapt**, not install and inherit.

A module becomes a package candidate only after repeated use demonstrates
that its API, assumptions, and extension points are sufficiently stable.

## Development

See `CONTRIBUTING.md` for branch naming, commit conventions, validation commands, dependency rules, and pull request expectations.

## Security

See `SECURITY.md` for vulnerability reporting and secret handling guidance.

## Status

This repository is evolving. Individual assets document their maturity,
limitations, validation history, and intended use.

## License

MIT. See `LICENSE`.
