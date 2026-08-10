# Next.js Internationalization Skill

Agent workflow skill for adding or migrating internationalization in a Next.js App Router application using `next-intl`.

## What this is

This is a skill for coding agents, not a reusable app package and not a standalone project template.

Store the complete skill directory in this toolbox, then add or reference it from the skills location used by the active workflow. The agent reads `SKILL.md` and the bundled `references/`, `assets/`, `scripts/`, and `evals/` files when performing an i18n migration in a target Next.js app.

## Activate it in a workflow

Use the mechanism supported by the agent workflow:

- If the workflow supports repository skill references, reference this directory, for example `@skills/nextjs-internationalization/`.
- If the workflow loads skills from a configured skills folder, copy or symlink the whole `skills/nextjs-internationalization/` directory into that folder.
- Keep the directory intact so relative paths from `SKILL.md` to `references/`, `assets/`, and `scripts/` continue to resolve.

## Ask the agent to use it

Run the agent from the target Next.js project, then ask for the migration explicitly:

```txt
Use the nextjs-internationalization skill to migrate this Next.js App Router app to next-intl with English and Arabic, default locale ar, locale-prefixed routes, RTL support, a language switcher, and localized metadata.
```

If the workflow uses path-based skill references:

```txt
Use @skills/nextjs-internationalization/ to add next-intl internationalization to this Next.js App Router app. Inspect the project first, then implement the migration.
```

## What the skill guides the agent to do

- Inspect the target app's Next.js version, App Router layout, config, middleware/proxy, routes, links, CSS, metadata, and data access.
- Install and configure `next-intl`.
- Create a centralized i18n library for locale metadata, routing, request config, navigation helpers, messages, and utilities.
- Add `proxy.ts` or `middleware.ts` with route exclusions for API/admin/static paths.
- Move public frontend routes under `[locale]`.
- Add `NextIntlClientProvider`, `<html lang>`, and `<html dir>` at the localized layout boundary.
- Replace internal links with locale-aware navigation helpers.
- Add a language switcher.
- Apply RTL/LTR styling and font strategy.
- Localize metadata, data fetching, cache keys, and CMS integration when present.
- Validate message key parity, type checking, linting, route behavior, switcher behavior, and RTL rendering.

## Included docs and helpers

- [`SKILL.md`](SKILL.md) — primary agent instructions.
- [`references/architecture.md`](references/architecture.md) — request flow, module roles, routing philosophy, RTL strategy, metadata flow, and source file coverage.
- [`references/conventions.md`](references/conventions.md) — naming, URL, layout, messages, navigation, language switcher, RTL, font, metadata, CMS, and cache conventions.
- [`references/migration-checklist.md`](references/migration-checklist.md) — ordered implementation checklist from discovery through validation.
- [`assets/`](assets/) — skill-owned implementation templates used by the agent as starting points inside the target app.
- [`scripts/check_message_keys.py`](scripts/check_message_keys.py) — message key parity validator.
- [`evals/evals.json`](evals/evals.json) — skill evaluation prompts from skill creation.

## Project-specific decisions

Before or during the migration, decide:

- supported locales and default locale
- URL policy, usually `localePrefix: 'always'`
- localized frontend routes vs. excluded admin/API/CMS routes
- which content lives in JSON messages vs. CMS/backend localization
- static vs. dynamic rendering strategy
- fonts and script-specific typography
- CMS localized fields and query behavior, if a CMS exists
