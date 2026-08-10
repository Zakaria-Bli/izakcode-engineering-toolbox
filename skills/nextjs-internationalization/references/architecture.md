# Architecture reference

This reference explains the architecture captured from the source project and generalized for future Next.js App Router applications.

## Table of contents

- Extracted architecture at a glance
- Why each module exists
- Complete request flow
- Routing philosophy
- Middleware/proxy composition
- RTL strategy
- Localized metadata flow
- Source implementation file coverage
- Project-specific details generalized

## Extracted architecture at a glance

The source implementation internationalizes only the public frontend application. It leaves API routes, Payload admin routes, generated admin layouts, and custom route handlers outside locale routing. Public pages live under a `[locale]` segment and the locale flows downward into layout, providers, header/footer, pages, CMS queries, metadata, navigation, and direction-aware UI.

Core choices:

- `next-intl` is the i18n runtime.
- Locale prefixes are explicit for all locales with `localePrefix: 'always'`.
- Locale data has one source of truth in `config.ts`.
- Routing, request configuration, navigation helpers, and CMS locale config are derived from that source.
- The root localized layout validates locales, sets `lang` and `dir`, loads messages, and provides `NextIntlClientProvider`.
- Internal navigation uses `createNavigation(routing)` wrappers rather than raw `next/link`.
- JSON message files are for UI chrome and accessibility strings. CMS-localized content remains in the CMS.
- RTL behavior starts at `<html dir>` and is refined with logical CSS utilities, `rtl:`/`ltr:` variants, direction-aware carousels, and script-specific fonts.

## Why each module exists

### `config.ts`: locale source of truth

Responsibility:

- Define the supported locale union type.
- Store metadata for each locale: code, English/admin name, native name, direction, and optional flag/icon.
- Define the default locale.
- Derive `localeCodes` for routing.
- Provide helpers such as `isRTL`, `getDirection`, `getLocaleConfig`, and `isValidLocale`.
- Optionally derive backend/CMS locale configuration, e.g. Payload's `{code, label, rtl}` objects.

Why it exists:

Locale data is needed by routing, request config, layouts, switchers, CMS config, tests, and helpers. Keeping it in one typed place prevents drift. The source project derived Payload localization from this same array, which avoided maintaining separate frontend and CMS locale lists.

Generalization:

Replace source-specific Arabic/English values with project locales. Keep direction and native names even if the first release only has LTR languages; they become important when adding RTL or building switchers.

### `routing.ts`: URL policy

Responsibility:

- Call `defineRouting` from `next-intl/routing`.
- Set `locales`, `defaultLocale`, and `localePrefix`.
- Optionally define localized pathnames if the project translates route slugs.

Why it exists:

Routing is the contract shared by middleware/proxy, navigation helpers, request config, and URL generation. The source used `localePrefix: 'always'` so default and non-default locales behave the same in URLs. This makes canonical metadata and switchers straightforward because every public path starts with a locale.

Generalization:

Keep `localePrefix: 'always'` unless the product explicitly wants unprefixed default-locale URLs. If changing to `as-needed` or `never`, update SEO helpers and tests accordingly.

### `request.ts`: request-scoped messages and locale validation

Responsibility:

- Use `getRequestConfig` from `next-intl/server`.
- Await `requestLocale`, validate it with `hasLocale`, and fall back to `routing.defaultLocale` for request context.
- Dynamically import the matching message JSON file.

Why it exists:

Server Components and `NextIntlClientProvider` need request-specific messages. This file is also what the `next-intl` plugin reads from `next.config.*`.

Design note:

The request config uses a safe fallback, while the layout still rejects invalid URL locales with `notFound()`. That split is intentional: request config remains robust, but route boundaries decide whether `/xx` is valid.

### `navigation.ts`: locale-aware navigation API

Responsibility:

- Call `createNavigation(routing)`.
- Export `Link`, `redirect`, `usePathname`, and `useRouter`.

Why it exists:

Components should not hand-roll locale prefixes. Centralized navigation lets `next-intl` apply the routing policy consistently. It also gives the language switcher a pathname without the locale prefix so it can switch locales cleanly.

Migration implication:

Internal app links should move from `next/link` to this module. External links, `mailto:`, `tel:`, and anchors should remain native `<a>` elements.

### `utils.ts`: small locale helpers

Responsibility:

- Re-export common direction helpers.
- Add presentation helpers, such as locale font class, native display name, and opposite direction.

Why it exists:

Direction and display helpers appear in layouts, carousels, switchers, and components. Keeping them small and colocated with config avoids ad-hoc `locale === 'ar'` checks.

### `index.ts`: public i18n API

Responsibility:

- Re-export config, routing, navigation, and utilities.

Why it exists:

Consumers can import from one stable module (`@/lib/i18n`) when they need general i18n helpers, and from `@/lib/i18n/navigation` when they need navigation-specific exports.

### `messages/[locale].json`: UI chrome translations

Responsibility:

- Store namespaces for common UI, layout, accessibility labels, and non-CMS feature copy.

Why it exists:

The source project uses a CMS for page and business content. JSON messages cover strings that belong to application code: menu labels like "open menu", aria labels, carousel labels, and language switcher copy.

Generalization:

If a project has no CMS, messages may contain more page copy. If it has a CMS, avoid duplicating CMS content in JSON.

### `next.config.*`: plugin composition

Responsibility:

- Wrap Next config with `createNextIntlPlugin('./path/to/request.ts')`.
- Preserve existing wrappers such as Payload, MDX, Sentry, bundle analyzers, or custom webpack settings.

Why it exists:

The plugin wires `next-intl` into the App Router build/runtime so request config and message loading work.

Source pattern:

The source composed `withNextIntl(withPayload(nextConfig, options))`. Future projects should preserve the same composition principle, even if wrapper names differ.

### `proxy.ts` or `middleware.ts`: locale routing boundary

Responsibility:

- Call `createMiddleware(routing)` from `next-intl/middleware`.
- Export a matcher that only applies to public frontend paths.

Why it exists:

The proxy/middleware detects or redirects locale prefixes and ensures route matching follows the routing config. The source uses `src/proxy.ts` because Next.js 16 renamed middleware to proxy.

Matcher philosophy:

Localize the frontend, not everything. Exclude API, admin/CMS, custom unlocalized handlers, internals, and static files. This avoids breaking endpoints and admin tooling.

### `app/(frontend)/[locale]/layout.tsx`: localized root layout

Responsibility:

- Validate the `[locale]` route param.
- Generate static params for locales when compatible with the rendering strategy.
- Load localized site metadata.
- Set request locale.
- Load messages.
- Render `<html lang={locale} dir={getDirection(locale)}>`.
- Configure script-specific fonts.
- Wrap children with `NextIntlClientProvider`.
- Render shared layout components with `locale` prop.

Why it exists:

This is the boundary where URL locale becomes rendering context. Everything below can assume the locale is valid. Setting `dir` on `html` lets CSS and component libraries respond globally.

Source-specific note:

The source forces dynamic rendering because public pages depend on CMS data and a production SQLite database should not be required during Docker image builds. In other projects, choose static or dynamic rendering based on data requirements.

### Localized page routes

Responsibility:

- Receive locale from params.
- Fetch localized data.
- Generate localized metadata.
- Pass locale into page view components.
- `notFound()` when localized content is missing.

Why they exist:

The locale segment should influence actual content, not just visible UI strings. In the source, CMS page and initiative queries all receive `locale`.

### SEO helpers

Responsibility:

- Build canonical and Open Graph URLs using localized paths.
- Include Open Graph locale.
- Pull localized titles/descriptions/images from CMS or messages.

Why they exist:

Metadata can drift from routing if every page hand-builds URLs. A helper centralizes the `localePrefix` assumption and uses the same locale passed into pages.

### Language switcher

Responsibility:

- Use the active locale from `useLocale`.
- Use the active pathname from i18n `usePathname`.
- Link to the same pathname with a different `locale` prop.
- Use locale metadata for labels, flags/icons, and direction.
- Use translated aria labels.

Why it exists:

Switching language should preserve the user's location. By letting `next-intl` build the URL, the switcher stays aligned with routing policy and avoids brittle string manipulation.

### CMS integration, when present

Responsibility:

- Configure CMS locales from `config.ts`.
- Mark human-authored fields localized.
- Query with `locale`.
- Include locale in cache keys.

Why it exists:

CMS content is the largest source of localized content. If CMS locale config and frontend locale config diverge, editors can create content the frontend cannot route to, or the frontend can route to locales the CMS does not support.

## Complete request flow

For a localized frontend request, e.g. `/en/projects/example`:

1. The browser requests a public frontend URL.
2. Next.js runs `src/proxy.ts` or `middleware.ts` if the matcher includes the path.
3. `next-intl` middleware applies the routing policy from `routing.ts`.
   - Missing locale prefixes redirect or resolve according to `localePrefix`.
   - Excluded paths bypass i18n entirely.
4. Next.js matches the route under `[locale]`.
5. The localized layout receives `params.locale`.
6. The layout validates locale using `hasLocale(routing.locales, locale)`.
   - Invalid locale paths call `notFound()`.
7. The layout calls `setRequestLocale(locale)`.
8. `next-intl` request config resolves the request locale and imports `messages/[locale].json`.
9. The layout calls `getMessages()` and renders `NextIntlClientProvider`.
10. The root HTML renders with `lang` and `dir` derived from locale config.
11. Shared server components, pages, and page view components receive `locale` explicitly.
12. Data access passes locale into CMS/backend queries.
13. Metadata helpers build canonical/Open Graph data from localized content and localized paths.
14. Client components use `useTranslations`, `useLocale`, and i18n navigation hooks from context.
15. Internal links use the centralized `Link`, which applies the routing policy.
16. The language switcher links to the current pathname with a different locale.

## Routing philosophy

The source project chooses explicit locale prefixes for all public pages. The benefits are:

- Every canonical URL encodes language.
- Default and non-default locales behave consistently.
- Language switching can preserve pathnames without special default-locale cases.
- Middleware behavior is easy to test.
- CMS previews and localized dynamic routes are less ambiguous.

Costs:

- Default-locale URLs are longer.
- Existing unprefixed routes need redirects or migration handling.

Use `localePrefix: 'always'` by default for this architecture. If the project has SEO history that requires unprefixed default locale, switch deliberately and document the changed URL policy.

## Middleware/proxy composition

When another proxy or middleware already exists, compose behavior rather than replacing it. The important decision is order:

- If auth/admin/API logic should bypass i18n, exclude those paths in the matcher or return early before next-intl.
- If all public pages should normalize locale before custom logic, run next-intl first for included frontend paths.
- Keep matcher exclusions readable and explain custom exclusions in comments.

Do not run locale middleware on Payload admin, API routes, static assets, or route handlers that are intentionally unlocalized.

## RTL strategy

RTL is handled at multiple layers because no single layer is enough:

1. Semantic root: `<html dir="rtl">` for RTL locales.
2. Typography: script-specific font variables/classes selected by `[dir]`.
3. Layout CSS: logical properties (`start`, `end`, `ps`, `pe`, `border-s`) before physical `left`/`right`.
4. Component exceptions: `rtl:` and `ltr:` variants for icons, transforms, drawer placement, decorative assets, and max-width tweaks.
5. Behavior: carousels and sliders receive explicit `direction` options.
6. Content overrides: phone numbers or code snippets can use `dir="ltr"` inside RTL pages.

This layered approach keeps most layout code direction-neutral while allowing precise exceptions.

## Localized metadata flow

The source metadata flow is:

1. Page/layout receives locale.
2. Metadata function fetches localized content and localized site settings.
3. Helper combines content-specific metadata with site defaults.
4. Helper prefixes the pathname with locale to build canonical URL.
5. Open Graph gets title, description, URL, site name, image, type, and locale.
6. `noIndex` controls robots when available.

Generalize this flow to any data source. The key is that metadata and page content use the same locale and same URL prefix policy.

## Source implementation file coverage

These source files shaped the skill. In future projects, reproduce the role, not the names or business content.

### Core i18n and routing

- `next.config.ts`: composes `createNextIntlPlugin('./src/lib/i18n/request.ts')` with existing Next wrappers. Preserve existing config and wrapper order.
- `src/proxy.ts`: Next.js 16 frontend locale proxy using `createMiddleware(routing)` with matcher exclusions for API, admin, custom route handlers, internals, and static files.
- `src/lib/i18n/config.ts`: locale metadata source of truth, default locale, derived code list, direction/validation helpers, and Payload locale derivation.
- `src/lib/i18n/routing.ts`: `defineRouting` with `localePrefix: 'always'`.
- `src/lib/i18n/request.ts`: request-locale validation and dynamic message loading.
- `src/lib/i18n/navigation.ts`: `createNavigation` exports for locale-aware links, redirects, router, and pathname.
- `src/lib/i18n/utils.ts`: presentation helpers around locale direction and display names.
- `src/lib/i18n/index.ts`: public i18n barrel.
- `src/lib/i18n/messages/ar.json` and `en.json`: UI chrome/accessibility messages.

### App layout and routes

- `src/app/(frontend)/[locale]/layout.tsx`: localized root layout, locale validation, static params, message provider, `html lang/dir`, fonts, header/footer, localized site metadata.
- `src/app/(frontend)/[locale]/(home)/page.tsx`: localized home page and metadata, mapping URL locale to CMS slug `home`.
- `src/app/(frontend)/[locale]/[slug]/page.tsx`: generic localized CMS page route.
- `src/app/(frontend)/[locale]/projects/page.tsx`: localized projects page route mapped to CMS slug `projects`.
- `src/app/(frontend)/[locale]/projects/[slug]/page.tsx`: localized dynamic detail route for initiatives/projects.
- `src/app/(frontend)/styles.css`: direction-aware fonts, RTL fallbacks, logical-ish utilities, and animation direction support.

### Shared layout and navigation UI

- `src/components/shared/LocaleSwitcher.tsx`: client switcher using `useLocale`, `useTranslations`, i18n `usePathname`, locale metadata, and `Link locale`.
- `src/components/layout/Header.tsx`: receives locale, fetches localized CMS global, renders internal links with i18n `Link`, preserves external/anchor links as native anchors, includes switcher.
- `src/components/layout/MobileMenu.tsx`: translates menu aria labels, receives locale for links, includes switcher, and uses `[dir]`/`rtl:` behavior for drawer direction and focus-safe mobile navigation.
- `src/components/layout/Footer.tsx`: receives locale, fetches localized CMS global, formats localized fallback labels, uses i18n links for internal URLs and native anchors for contact/external links.

### Page rendering and content components

- `src/components/page-builder/PayloadPageView.tsx`: fetches localized CMS page by slug and passes locale to renderer.
- `src/components/page-builder/RenderPageLayout.tsx`: turns localized CMS blocks into components; derives direction from locale; passes locale to links, archives, projects, services, and direction-aware components.
- `src/components/landing/hero/HeroSection.tsx`: server component using translated aria labels and locale-aware action links.
- `src/components/landing/hero/HeroCarousel.tsx`: client carousel using `useLocale`, translated aria labels, and behavior-level direction.
- `src/components/landing/projects/ProjectsSection.tsx`, `ProjectsCarousel.tsx`, `ProjectCard.tsx`: pass locale to internal links and direction to mobile carousel/visual offsets.
- `src/components/landing/ServicesSection.tsx`: locale-aware internal CTA links and RTL icon/decorative transforms.
- `src/components/landing/PartnersSection.tsx`: direction-aware marquee animation.
- `src/components/landing/StackedTabs.tsx`: `ltr:`/`rtl:` text alignment for tab content.
- `src/components/archive/InitiativesArchiveList.tsx`: locale-aware cards and RTL pagination icon flipping.
- `src/components/initiatives/InitiativePageView.tsx`: localized detail data, localized shared UI labels, direction passed to hero.
- `src/components/initiatives/InitiativeHero.tsx`: direction-aware carousel and RTL control icons.
- `src/components/initiatives/InitiativeContribution.tsx`: locale-aware internal links and RTL back icon.

### CMS, data, and metadata

- `src/payload.config.ts`: Payload localization derives locales/default from i18n config.
- `src/collections/*`, `src/globals/*`, `src/fields/link.ts`, `src/fields/seo.ts`: mark editor-facing fields localized while stable identifiers and relationships generally remain unlocalized.
- `src/lib/payload/getPages.ts`, `getInitiatives.ts`, `getFAQs.ts`, `getGlobals.ts`: pass locale into Payload queries and include locale in cache keys.
- `src/lib/seo.ts`: builds localized canonical/Open Graph metadata according to the route prefix policy.
- `src/payload-types.ts`: generated type output reflecting configured locale union; regenerate rather than hand-edit.

## Project-specific details generalized

The source project had these specifics, which should become placeholders in future projects:

- Locales: Arabic and English. Generalize to any locale codes.
- Default locale: Arabic. Choose per product.
- Flags: Algeria/US emoji. Use product-appropriate flags/icons or omit flags.
- Fonts: Cairo for Arabic and Noto Sans for Latin. Choose fonts per scripts.
- CMS: Payload CMS. For other CMSs, apply the same locale-source and query principles.
- Route group: `(frontend)` plus `(payload)`. Use route groups only when the project has separate frontend/admin route trees.
- Custom exclusions: `admin` and `my-route`. Replace with the project's own unlocalized paths.
- Branding and fallback copy: AUF-specific. Replace with project content or avoid hardcoded fallback copy when CMS content is required.
