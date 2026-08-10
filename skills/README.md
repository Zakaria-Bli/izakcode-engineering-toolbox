# Skills

Reusable agent skills, rules, and workflow instructions. Skills are added to the appropriate agent/workflow skills location, then invoked by asking the agent to use them.

## Catalog

| Skill                                                                 | Use it for                                                                                                                                                                             | Docs                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`layered-feature-scaffold`](layered-feature-scaffold/SKILL.md)       | Scaffolding and reviewing feature/domain folders that follow Pragmatic Layered Architecture.                                                                                           | [`patterns/pragmatic-layered-architecture.md`](../patterns/pragmatic-layered-architecture.md), [`docs/decisions/0003-pragmatic-layered-architecture.md`](../docs/decisions/0003-pragmatic-layered-architecture.md) |
| [`nextjs-internationalization`](nextjs-internationalization/SKILL.md) | Agent workflow skill for adding or migrating i18n in Next.js App Router apps with `next-intl`, locale-prefixed routes, RTL support, localized metadata, and optional CMS localization. | [`usage`](nextjs-internationalization/README.md), [`docs/decisions/0004-nextjs-internationalization.md`](../docs/decisions/0004-nextjs-internationalization.md)                                                    |

## Skill layout

Keep each skill self-contained when possible:

```txt
skills/<skill-name>/
  SKILL.md
  references/
  assets/
  scripts/
  evals/
```

Use `references/` for long-form rules and rationale loaded by the skill. Use `assets/` for skill-owned templates, examples, or starter files consumed by the agent during implementation. Use skill-local `scripts/` for automation that belongs to that skill. Root `scripts/` remains reserved for repository maintenance.
