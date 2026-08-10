# Conventions reference

Use this reference when adapting the skill to an existing project. It lists the implementation conventions extracted from the source project, the reasoning behind them, and anti-patterns to avoid.

## Naming and file placement

Preferred module layout:

```text
src/lib/i18n/
  config.ts
  routing.ts
  request.ts
  navigation.ts
  utils.ts
  index.ts
  messages/
    en.json
    ar.json
```

Acceptable alternatives:

- `src/i18n/*` if the project already uses that convention.
- `messages/*` at project root if that is already established, as long as `request.ts` imports from the correct path.

Keep all i18n primitives colocated. Do not scatter locale constants across app routes, CMS config, switchers, and metadata helpers.

## Locale metadata convention

Each locale should have a typed metadata entry:

```ts
{
  code: 'en',
  name: 'English',
  nativeName: 'English',
  direction: 'ltr',
  flag: '🇺🇸'
}
```

`flag` can be replaced by `icon`, `label`, or omitted. `direction` and `nativeName` should remain because they support RTL, accessibility, and language switchers.

Derived values should come from the metadata array:

- locale code list for `defineRouting`
- validation helpers
- direction helpers
- language switcher options
- CMS locale objects
- tests and scripts

## URL convention

Default for this architecture:

```ts
localePrefix: "always"
```

This means:

- `/en`
- `/ar`
- `/en/about`
- `/ar/about`

Why preserve it:

- Canonical URLs are easy to compute.
- Default and non-default locales behave the same.
- Language switchers do not need special default-locale path logic.
- CMS-backed dynamic pages have unambiguous localized URLs.

If the user requires unprefixed default-locale URLs, update all affected areas:

- routing config
- SEO canonical helper
- redirect expectations
- language switcher tests
- sitemap/alternate URLs if present

## Layout convention

The localized layout is the locale boundary. It should:

- receive `[locale]` from route params
- validate locale and reject invalid URL segments
- set request locale
- load messages
- set `<html lang>` and `<html dir>`
- configure fonts
- provide `NextIntlClientProvider`
- pass locale to shared server-rendered layout components

Do not bury locale validation deep in page components. Pages should be able to trust the layout boundary.

## Message convention

Use JSON messages for app-owned UI text:

- common UI labels
- menu open/close labels
- language switcher labels
- carousel aria labels
- validation errors
- form chrome
- fallback metadata for non-CMS apps

Use CMS/backend localization for author-owned content:

- page titles and body content
- navigation labels managed by editors
- SEO overrides managed by editors
- project/product/service descriptions
- legal/footer copy if editor-managed

Keep all locale files structurally identical. Prefer nested namespaces over flat keys once the app grows.

## Navigation convention

Use the centralized navigation module for internal links:

```ts
import { Link } from "@/lib/i18n/navigation"
```

Pass `locale` explicitly from server components when available:

```tsx
<Link href="/projects" locale={locale}>
  Projects
</Link>
```

Client components can rely on active locale where appropriate, but explicit `locale` is still useful when switching languages.

Use native anchors for:

- external URLs
- `mailto:`
- `tel:`
- same-page anchors like `#about`
- files/downloads when they should not be routed by Next

Avoid this anti-pattern:

```tsx
<Link href={`/${locale}/projects`}>Projects</Link>
```

It duplicates routing logic and breaks when `localePrefix` or localized pathnames change.

## Language switcher convention

The source language switcher supports two shapes:

- Toggle mode for exactly two locales.
- Dropdown mode for more than two locales.

Core behavior to preserve:

- Use `useLocale()` for active locale.
- Use `usePathname()` from i18n navigation, not `next/navigation`.
- Use `Link href={pathname || '/'} locale={targetLocale}`.
- Translate aria labels.
- Render each native language name with `dir={localeOption.direction}`.
- Show current locale state in dropdowns with `aria-current`.
- Avoid manual URL parsing or replacing the first path segment.

UI library is adaptable. The source used shadcn/Radix dropdown primitives and Tailwind; future projects can use a native select, custom menu, or existing design system as long as the behavior stays the same.

## RTL conventions

Prefer direction-neutral CSS:

- `start` / `end`
- `inset-s` / `inset-e` if available
- `ms` / `me`
- `ps` / `pe`
- `border-s` / `border-e`
- `text-start` / `text-end`

Use physical left/right only when a visual asset or component truly has a physical orientation.

Use `rtl:` and `ltr:` variants for exceptions:

```tsx
<ArrowLeft className="rtl:rotate-180" />
<div className="ltr:right-0 rtl:left-0" />
```

Use `dir="ltr"` for phone numbers, email-like strings if needed, code, IDs, and other content that should not be bidi-reordered inside RTL text.

For carousels or sliders, pass direction into the behavior layer:

```tsx
<Carousel opts={{ direction: getDirection(locale) }} />
```

CSS mirroring alone may not change keyboard, swipe, or pagination behavior.

## Font convention

Load script-appropriate fonts in the localized layout or a root layout and expose CSS variables:

```ts
const latin = SomeLatinFont({ variable: "--font-latin", subsets: ["latin"] })
const arabic = SomeArabicFont({ variable: "--font-arabic", subsets: ["arabic"] })
```

Then select based on `[dir]` or locale-specific classes:

```css
[dir="rtl"] body {
  font-family: var(--font-arabic), sans-serif;
}
[dir="ltr"] body {
  font-family: var(--font-latin), sans-serif;
}
```

Do not assume every RTL locale uses the same font or every LTR locale uses Latin. For larger language sets, map fonts by script or locale.

## Metadata convention

Centralize localized URL building:

```ts
function getLocalizedPath(pathname: string, locale: Locale) {
  if (!pathname || pathname === "/") return `/${locale}`
  return `/${locale}${pathname}`
}
```

This exact helper assumes `localePrefix: 'always'`. If the routing policy changes, update the helper rather than changing every page.

Metadata should be generated using the same locale as page content. Do not fetch default-locale metadata for non-default-locale pages unless the product explicitly wants fallback behavior.

## CMS conventions

When integrating with Payload CMS, the source project used these conventions:

- `payloadLocales` derived from i18n config.
- `localization.defaultLocale` uses the same `defaultLocale`.
- `fallback: true` enabled CMS fallback behavior.
- Human-authored display fields use `localized: true`.
- Stable identifiers such as slugs, names, booleans, order fields, media relations, and internal IDs are usually not localized.
- Fetch functions accept `locale` and pass it into Payload queries.
- Cache keys include `locale`.
- Revalidation tags stay content-oriented; locale in keys prevents cross-language cache leakage.

For other CMSs, preserve the principles rather than the Payload API syntax.

## Route groups convention

Use route groups to isolate localized and unlocalized trees:

```text
app/
  (frontend)/
    [locale]/
      layout.tsx
      page.tsx
  (admin)/
    admin/...
  api/...
```

Route groups are not required in simple apps, but they are useful when admin/CMS layouts should not inherit frontend providers, fonts, or locale routing.

## Cache convention

Every locale-dependent cache needs the locale in the cache key:

```ts
unstable_cache(() => getPageBySlug(slug, locale), [slug, locale], {tags: [...]})
```

Without locale in the key, the first language requested can be served to later requests in another language.

## Static vs dynamic rendering convention

The source layout exported `dynamic = 'force-dynamic'` due CMS/runtime database requirements. This is not a universal rule.

Choose based on project needs:

- Static-friendly marketing site: use `generateStaticParams()` and current `next-intl` static rendering guidance. Add page-level `setRequestLocale` when needed by the installed `next-intl` version.
- CMS/runtime data site: use dynamic rendering deliberately and document why.
- Mixed app: static for stable pages, dynamic for preview/CMS/draft routes.

## Anti-patterns to avoid

- Multiple locale constants across unrelated files.
- Manual URL rewriting in the language switcher.
- Middleware/proxy matcher that catches `/api`, `/admin`, `/_next`, or files with extensions.
- Raw `next/link` for internal app links after i18n navigation exists.
- Locale-aware content fetchers with cache keys that omit locale.
- Hardcoded `locale === 'ar'` checks scattered through components.
- Translating editor-managed CMS content into JSON messages.
- Global CSS that only handles RTL through physical left/right overrides.
- Assuming flags are languages. They are optional display aids and can be politically/product-sensitive.
- Forgetting metadata, sitemap, or canonical URL localization.
