# 0004. Next.js Internationalization Skill

Date: 2026-08-10

## Status

Accepted

## Context

The toolbox needs a repeatable agent workflow for adding multilingual support to Next.js App Router projects without rediscovering the same routing, message-loading, RTL, metadata, and CMS localization decisions each time.

This asset is not a reusable app package and not a copy-and-adapt pattern document. It is a coding-agent skill: keep the full skill directory in the toolbox, add or reference it from the skills location used by the active workflow, then ask the agent to use it while working inside the target Next.js project.

A source project produced a validated implementation approach around `next-intl`, explicit locale prefixes, a `[locale]` frontend route boundary, localized metadata/data access, RTL handling, and a shared locale metadata source. Capturing that approach as a skill gives the agent ordered instructions, references, templates, and validation helpers for real migrations.

## Decision

Track **Next.js Internationalization** as a self-contained workflow skill:

```txt
skills/nextjs-internationalization/README.md
skills/nextjs-internationalization/SKILL.md
skills/nextjs-internationalization/references/architecture.md
skills/nextjs-internationalization/references/conventions.md
skills/nextjs-internationalization/references/migration-checklist.md
skills/nextjs-internationalization/assets/*.template.*
skills/nextjs-internationalization/scripts/check_message_keys.py
skills/nextjs-internationalization/evals/evals.json
```

Use this skill by adding or referencing the whole `skills/nextjs-internationalization/` directory in the workflow-specific skills location, then prompting the agent from the target app, for example:

```txt
Use the nextjs-internationalization skill to migrate this Next.js App Router app to next-intl with English and Arabic, default locale ar, locale-prefixed routes, RTL support, a language switcher, and localized metadata.
```

The skill should be used when adding or migrating i18n in Next.js App Router apps, especially when the project needs one or more of:

- `next-intl` setup and App Router routing
- locale-prefixed frontend routes
- English/Arabic or other RTL language support
- localized metadata and canonical URLs
- a language switcher that preserves the current route
- locale-aware CMS/data fetching and cache keys
- Payload CMS locale derivation from the frontend locale config

The target implementation produced by the agent usually contains:

```txt
src/lib/i18n/
  config.ts       # locale metadata source of truth
  routing.ts      # next-intl defineRouting URL policy
  request.ts      # request-scoped message loading
  navigation.ts   # locale-aware Link/router/pathname helpers
  utils.ts        # direction, display, and font helpers
  index.ts        # public i18n API
  messages/
    <locale>.json

app/(frontend)/[locale]/...
src/proxy.ts or middleware.ts
components/shared/LocaleSwitcher.tsx
```

Use `localePrefix: 'always'` as the default routing policy unless product or SEO requirements call for another policy. Keep admin, API, CMS, Next internals, and static files outside locale proxy/middleware matching. Set `lang` and `dir` at the localized root layout and pass locale through pages, metadata, data access, cache keys, and shared layout components.

## Consequences

Benefits:

- The workflow is explicit: install/reference the skill, then ask the agent to use it in the target app.
- The skill gives agents an ordered migration path instead of isolated code snippets.
- Bundled references explain the request flow, conventions, and migration checklist only when needed.
- Bundled assets give the agent implementation starting points without making this a reusable package.
- A single source of locale truth prevents routing, switchers, CMS config, and metadata from drifting.
- RTL is handled semantically at the document root and reinforced with direction-aware CSS and components.
- CMS-backed projects can localize authored content without duplicating that content in JSON message files.
- The message key parity script adds a simple validation step for translation files.

Tradeoffs:

- The skill must be placed where the active workflow can load skills; keeping it only in the toolbox is not enough for every agent.
- Moving public routes under `[locale]` is a broad migration that affects imports, links, metadata, and tests.
- Explicit locale prefixes make default-locale URLs longer.
- Existing middleware/proxy, auth, CMS, and API routes require careful matcher composition.
- The architecture assumes App Router and `next-intl`; other routing libraries or Pages Router apps need a different skill or manual adaptation.
- Static versus dynamic rendering must still be decided per project based on data and CMS requirements.

## Alternatives considered

- **Use `next-intl` docs directly each time**: rejected as the only workflow because official docs cover primitives but do not encode this toolbox's full migration order, CMS boundary, RTL strategy, agent prompts, and validation helpers.
- **Create a reusable package**: rejected because each project has different route groups, locales, CMS fields, fonts, metadata rules, and middleware exclusions. A workflow skill fits better.
- **Document only a pattern in `patterns/`**: rejected because the intended use is agent execution through the workflow's skills mechanism, not a human reading a pattern and manually applying it.
- **Localize only strings without locale-prefixed routes**: rejected for projects needing canonical multilingual URLs, route-preserving language switching, and localized CMS/data access.
