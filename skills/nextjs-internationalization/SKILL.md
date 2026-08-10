---
name: nextjs-internationalization
description: Implement and migrate internationalization in Next.js App Router apps with next-intl. Use this skill whenever the user asks to add multiple languages, locale-prefixed routes, translations, a language switcher, English/Arabic or other RTL support, localized metadata, Payload/CMS locale integration, or to migrate an existing Next.js app to i18n, even if they only mention RTL or multilingual routing.
---

# Next.js Internationalization

Use this skill to add or migrate internationalization in a Next.js App Router application using the architecture reverse-engineered from the source project: `next-intl`, a locale segment at the frontend route root, a single locale metadata source of truth, centralized locale-aware navigation helpers, request-scoped message loading, explicit RTL handling, and localized metadata/data access.

The goal is not just to translate strings. Build a predictable routing and rendering layer where locale flows from the URL into layout, providers, data queries, links, metadata, UI copy, and direction-aware styling.

## Before implementing: inspect first

1. Identify the Next.js version and router style.
   - App Router is expected.
   - Next.js 16 prefers `proxy.ts`; Next.js 15 and earlier usually use `middleware.ts`.
2. Locate the app root: `app/`, `src/app/`, and any route groups like `(frontend)` or `(admin)`.
3. Locate `next.config.*`, `tsconfig.json`, package manager, Tailwind/global CSS, and existing middleware/proxy.
4. Search for existing i18n, locale, `next/link`, `next/navigation`, metadata helpers, CMS queries, cached data functions, and hardcoded UI strings.
5. If a CMS exists, determine which content is CMS-localized versus JSON-message-localized. In the source architecture, CMS content stays in the CMS and JSON messages are used for application chrome and accessibility labels.
6. Read the relevant current docs before coding if behavior may differ by version: `next-intl` App Router setup/routing and Next.js proxy or middleware docs.

Read `references/architecture.md` when you need the full request flow, source file coverage map, and reasoning. Read `references/conventions.md` before migrating a real project with existing routes, links, CMS data, or RTL styling. Use `references/migration-checklist.md` as the execution checklist.

## Expected architecture

Create a compact i18n library under a single folder such as `src/lib/i18n/` or `src/i18n/`:

- `config.ts`: supported locale metadata, default locale, derived locale codes, direction helpers, validation, optional CMS locale config.
- `routing.ts`: `next-intl` `defineRouting` using the locale codes from `config.ts`.
- `request.ts`: `getRequestConfig` that validates `requestLocale`, falls back safely, and loads locale JSON messages.
- `navigation.ts`: `createNavigation(routing)` exports for `Link`, `redirect`, `usePathname`, and `useRouter`.
- `utils.ts`: small helpers such as font class names, display names, opposite direction, and re-exports.
- `index.ts`: public API barrel.
- `messages/[locale].json`: UI chrome translations, not a dumping ground for CMS content.

Wire these into:

- `next.config.*` with `createNextIntlPlugin('./path/to/request.ts')`, composed with any existing wrappers.
- `src/proxy.ts` or `middleware.ts` with `createMiddleware(routing)` and a matcher that excludes API, admin/CMS, Next internals, and static files.
- `app/[locale]/layout.tsx` or `app/(frontend)/[locale]/layout.tsx` as the localized root layout.
- Localized pages under `[locale]`, passing locale into data access and metadata.
- A client `LocaleSwitcher` that uses `useLocale`, `usePathname`, translated labels, locale metadata, and the centralized `Link`.
- Global CSS and components that respond to the root `html dir` attribute.

## Implementation order and why it matters

Follow this order. It prevents circular fixes where links, layouts, and messages disagree about which locales exist.

### 1. Install and configure the package

Install `next-intl` with the project's package manager. Preserve all existing Next config wrappers and compose the plugin around them.

Use `assets/next-config-snippet.template.ts` as a reference. The important convention is that the plugin points at the request config file you will create, e.g. `./src/lib/i18n/request.ts`.

### 2. Create the locale source of truth

Start with `config.ts`, based on `assets/config.template.ts`. Put every supported locale in one typed metadata array with:

- code
- English/admin name
- native display name
- direction (`ltr` or `rtl`)
- optional flag or UI icon

Derive `localeCodes`, `defaultLocale`, helpers, and any CMS-specific locale config from this same data. Avoid duplicating locale lists in routing, middleware, payload/CMS config, switchers, tests, or metadata helpers.

### 3. Create routing, request config, navigation helpers, and barrel exports

Use the assets:

- `routing.template.ts`
- `request.template.ts`
- `navigation.template.ts`
- `utils.template.ts`
- `index.template.ts`

Keep routing small. The source project used `localePrefix: 'always'` so every public URL is explicit, including the default locale. This makes canonical URLs, language switching, and middleware behavior predictable. Adapt only if the user explicitly wants default-locale URLs unprefixed; then update metadata and switcher logic accordingly.

### 4. Add proxy or middleware routing

Use `assets/proxy-next16.template.ts` for Next.js 16 or `assets/middleware-next15.template.ts` for older projects. Exclude non-frontend paths deliberately:

- API routes
- admin/CMS routes
- custom route handlers that must remain unlocalized
- `_next`, `_vercel`, and files with extensions

This architecture localizes the frontend route tree, not the whole server.

### 5. Move the frontend route tree under `[locale]`

For App Router, make the localized frontend root a route segment:

```text
app/(frontend)/[locale]/layout.tsx
app/(frontend)/[locale]/page.tsx
app/(frontend)/[locale]/[slug]/page.tsx
```

If the project has no route groups, `app/[locale]/...` is fine. If it has admin/API/CMS routes, route groups keep those routes outside locale handling.

In the localized layout:

- Validate the route locale with `hasLocale(routing.locales, locale)` and `notFound()` invalid locale paths.
- Call `setRequestLocale(locale)` so server components can resolve the request locale consistently.
- Load messages with `getMessages()`.
- Render `<html lang={locale} dir={getDirection(locale)}>`.
- Wrap children in `NextIntlClientProvider`.
- Pass `locale` to server-rendered shared layout components such as header/footer.
- Configure locale-specific fonts at the layout/root CSS level when needed.

Use `assets/localized-layout.template.tsx` and adapt for the project's Next version. Next.js 16 route `params` are often typed as promises in this source project; older projects may use plain objects.

### 6. Update pages, data access, and metadata to receive locale

Every localized page should read `locale` from params, pass it into data fetchers, and use it in `generateMetadata`.

Patterns to preserve:

- Query CMS/backend data with `locale`.
- Include `locale` in cache keys for `unstable_cache` or equivalent caches.
- Use localized CMS fields for business content.
- Use JSON messages for UI chrome, aria labels, and non-CMS copy.
- Call `notFound()` when localized content does not exist.
- Build canonical/Open Graph URLs with the locale prefix if using `localePrefix: 'always'`.

Use `assets/seo.template.ts` for localized metadata helpers and `assets/page-route.template.tsx` for route patterns.

### 7. Replace navigation imports with centralized helpers

Internal links should import `Link` from the i18n navigation module, not `next/link`. Server components should pass `locale={locale}` when rendering known internal links from CMS or props. Client components can use `usePathname()` from the same navigation module.

Keep external URLs, `mailto:`, `tel:`, and same-page anchors as native `<a>` elements. Let `next-intl` own locale prefixes for internal app paths; do not manually concatenate `/${locale}` in component links.

### 8. Add messages and translate application chrome

Create one JSON file per locale under `messages/`. Use stable namespaces such as:

- `common`
- `header`
- `metadata`
- feature namespaces like `hero`, `forms`, or `errors`

Keep key structures identical across locale files. Use `scripts/check_message_keys.py` to check parity after edits.

### 9. Build the language switcher

Use `assets/locale-switcher-basic.template.tsx` for a dependency-light version or `assets/locale-switcher-shadcn.template.tsx` if the project uses shadcn/Radix dropdowns.

Preserve the source behavior:

- Client component.
- Current locale from `useLocale()`.
- Current localized pathname from i18n `usePathname()`.
- Locale metadata from `config.ts`.
- `Link href={pathname || '/'} locale={targetLocale}` rather than manual path rewriting.
- Toggle variant for exactly two locales; dropdown for more.
- Translated aria labels.
- Native names rendered with their own `dir`.
- Pending state so repeated switches feel disabled during transition.

### 10. Apply RTL and font strategy

Set direction once on `<html>`. Prefer CSS logical properties and Tailwind logical utilities (`start`, `end`, `ps`, `pe`, `border-s`) over left/right. Use `rtl:` and `ltr:` variants for exceptional transforms and animations.

Use `assets/rtl-styles.template.css` as the base. Add locale fonts in layout and global CSS. For carousels/sliders, pass the locale direction into the component rather than relying only on CSS mirroring.

### 11. Integrate CMS localization only if the project has a CMS

The source project used Payload CMS and derived Payload locale config from `config.ts`. If a project uses Payload, adapt `assets/payload-config-snippet.template.ts`:

- Configure `localization.locales` from the i18n config.
- Set `defaultLocale` from the same source.
- Mark human-authored content fields as `localized: true`.
- Query collections/globals with `locale`.
- Include locale in cache keys.

For other CMSs, preserve the same concept: one source of locale truth, localized content fields in the CMS, locale-aware queries, and no duplicated locale constants.

## Files to create vs. modify

Create:

- `src/lib/i18n/config.ts`
- `src/lib/i18n/routing.ts`
- `src/lib/i18n/request.ts`
- `src/lib/i18n/navigation.ts`
- `src/lib/i18n/utils.ts`
- `src/lib/i18n/index.ts`
- `src/lib/i18n/messages/*.json`
- `src/proxy.ts` or `middleware.ts` if absent
- `components/shared/LocaleSwitcher.tsx` or equivalent
- optional `src/lib/seo.ts` localized metadata helpers

Modify:

- `next.config.*` to add the next-intl plugin without dropping existing config.
- App routes/layouts to live under `[locale]`.
- Header/footer/nav components to receive locale and use i18n `Link`.
- Pages and data fetchers to pass locale.
- Global CSS and affected components for direction-aware layout.
- CMS config/queries if content is CMS-backed.

## Decisions not to hardcode

Ask or infer these per project:

- Supported locales and default locale.
- URL policy: `localePrefix: 'always'` by default for this architecture, but adapt if product requirements differ.
- Which routes should be localized versus excluded.
- Which strings belong in JSON messages versus CMS/backend content.
- Whether static rendering is desired. If yes, follow current next-intl static rendering guidance and use `generateStaticParams` and page-level `setRequestLocale` as needed. If CMS data must render at runtime, use dynamic rendering deliberately.
- Font families and script-specific typography.
- CMS schema details and localized fields.

## Validation

Run these before declaring completion:

1. `pnpm type-check` or the project's equivalent.
2. `pnpm lint` if available.
3. `python scripts/check_message_keys.py path/to/messages` from this skill, or equivalent, to verify translation key parity.
4. Visit each locale prefix: `/defaultLocale`, `/otherLocale`, nested routes, dynamic routes.
5. Visit an invalid locale like `/xx` and confirm it 404s or redirects according to the routing policy.
6. Confirm internal links preserve or intentionally switch locale, while external/anchor links remain native.
7. Confirm language switcher preserves the current pathname.
8. Confirm `<html lang>` and `<html dir>` update per locale.
9. Check RTL pages for text alignment, icons, drawers, carousels, and directional animations.
10. Inspect canonical/Open Graph URLs for correct locale prefixes.
11. For CMS apps, verify localized content queries and cache keys include locale.

## Common pitfalls

- Duplicating locale arrays in multiple files. This causes routing, switchers, CMS config, and metadata to drift.
- Using `next/link` for internal localized links after adding `createNavigation`.
- Manually prefixing `/${locale}` in components. Let the routing helpers do that.
- Applying middleware/proxy to admin/API/static routes.
- Translating CMS content into JSON messages or putting UI chrome in CMS without reason.
- Forgetting locale in cache keys, causing one language to leak into another.
- Setting RTL only in component CSS instead of on `<html dir>`.
- Using physical left/right utilities everywhere instead of logical properties.
- Building canonical URLs without matching the chosen locale prefix policy.

## Completion checklist

- Locale source of truth exists and is reused everywhere.
- `next-intl` plugin, routing, request config, navigation helpers, and proxy/middleware are wired.
- Frontend routes are under `[locale]` and invalid locales are handled.
- Provider, messages, `lang`, `dir`, fonts, header, footer, and pages receive locale.
- Internal links use i18n navigation helpers.
- Language switcher works from nested and dynamic routes.
- RTL and LTR layouts are both visually sane.
- Metadata and CMS/data fetching are localized.
- Validation commands pass.
