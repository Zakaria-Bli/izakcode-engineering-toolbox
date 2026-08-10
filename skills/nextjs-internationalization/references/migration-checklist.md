# Migration checklist

Use this checklist to execute a Next.js App Router i18n migration in the order used by the skill.

## 0. Discovery

- [ ] Confirm App Router is used.
- [ ] Record Next.js version.
- [ ] Record package manager.
- [ ] Locate `next.config.*`.
- [ ] Locate existing `middleware.ts`, `proxy.ts`, rewrites, redirects, auth middleware, or CMS middleware.
- [ ] Locate public frontend route tree.
- [ ] Locate unlocalized trees: API, admin, CMS, route handlers, static assets.
- [ ] Locate global CSS and Tailwind setup.
- [ ] Locate current internal links and navigation components.
- [ ] Locate metadata helpers and `generateMetadata` functions.
- [ ] Locate data access and cache functions.
- [ ] Locate CMS config and localized/content fields if applicable.
- [ ] Ask or infer supported locales and default locale.
- [ ] Ask or infer whether all public URLs should have explicit locale prefixes.

## 1. Dependencies and docs

- [ ] Install `next-intl`.
- [ ] Check current `next-intl` App Router setup/routing docs.
- [ ] Check Next.js version-specific proxy/middleware convention.
- [ ] Plan config wrapper composition before editing `next.config.*`.

## 2. Create i18n library

- [ ] Create `src/lib/i18n/config.ts` from the locale metadata template.
- [ ] Add `Locale` type, `locales`, `defaultLocale`, `localeCodes`.
- [ ] Add `isRTL`, `getDirection`, `getLocaleConfig`, `isValidLocale`.
- [ ] Add optional CMS locale derivation if the app uses a CMS.
- [ ] Create `routing.ts` with `defineRouting`.
- [ ] Create `request.ts` with `getRequestConfig`, locale validation, fallback, and dynamic message import.
- [ ] Create `navigation.ts` with `createNavigation(routing)`.
- [ ] Create `utils.ts` and `index.ts`.
- [ ] Create `messages/[locale].json` for each locale.

## 3. Configure Next.js

- [ ] Import `createNextIntlPlugin` in `next.config.*`.
- [ ] Point plugin to `./src/lib/i18n/request.ts` or the actual request config path.
- [ ] Compose with existing config wrappers without dropping existing config.
- [ ] Run type check or start dev server to catch config syntax errors.

## 4. Configure proxy or middleware

- [ ] Use `src/proxy.ts`/`proxy.ts` for Next.js 16.
- [ ] Use `middleware.ts` for Next.js 15 or earlier unless the project already supports proxy.
- [ ] Export `createMiddleware(routing)`.
- [ ] Add matcher excluding API, admin/CMS, custom unlocalized handlers, `_next`, `_vercel`, and static files.
- [ ] If existing middleware exists, compose behavior and document ordering.

## 5. Move frontend routes under `[locale]`

- [ ] Create `app/(frontend)/[locale]/layout.tsx` or `app/[locale]/layout.tsx`.
- [ ] Move public pages under `[locale]`.
- [ ] Keep API/admin/CMS routes outside `[locale]`.
- [ ] Update imports affected by moved routes.
- [ ] Validate locale in layout with `hasLocale` and `notFound()`.
- [ ] Call `setRequestLocale(locale)`.
- [ ] Load `getMessages()`.
- [ ] Set `<html lang={locale} dir={getDirection(locale)}>`.
- [ ] Add `NextIntlClientProvider`.
- [ ] Pass locale to header/footer/shared server components.
- [ ] Decide static vs dynamic rendering and document why.

## 6. Update pages and data flow

- [ ] Update page prop types to include locale params.
- [ ] Pass locale into page view components.
- [ ] Pass locale into CMS/backend queries.
- [ ] Include locale in cache keys.
- [ ] Handle draft/preview mode without losing locale.
- [ ] Call `notFound()` for missing localized content.
- [ ] Update dynamic routes under `[locale]`.

## 7. Update metadata

- [ ] Create or update localized SEO helper.
- [ ] Build canonical URLs according to the selected `localePrefix` policy.
- [ ] Include locale in Open Graph metadata where applicable.
- [ ] Fetch localized site settings/page metadata.
- [ ] Update every `generateMetadata` to use the route locale.
- [ ] Add fallback metadata only where appropriate.

## 8. Update navigation

- [ ] Replace internal `next/link` imports with i18n navigation `Link`.
- [ ] Pass `locale` explicitly in server components.
- [ ] Keep external, `mailto:`, `tel:`, and anchor links as native `<a>`.
- [ ] Remove manual `/${locale}` concatenation from component links.
- [ ] Update redirects to use i18n navigation helpers where appropriate.
- [ ] Ensure CMS link resolvers return unlocalized internal paths.

## 9. Add language switcher

- [ ] Choose basic or design-system template.
- [ ] Use `useLocale` and i18n `usePathname`.
- [ ] Use locale metadata from config.
- [ ] Use `Link` with `locale={targetLocale}`.
- [ ] Add translated aria labels.
- [ ] Render native names with their own `dir`.
- [ ] Use toggle behavior only when there are exactly two locales.
- [ ] Use dropdown/list behavior for 3 or more locales.
- [ ] Add switcher to header and mobile nav if present.

## 10. Add RTL and typography

- [ ] Load locale/script fonts.
- [ ] Add font variables/classes to body.
- [ ] Add global CSS for `[dir="rtl"]` and `[dir="ltr"]` font selection.
- [ ] Replace physical spacing/alignment with logical utilities where practical.
- [ ] Add `rtl:`/`ltr:` variants for icons, drawers, decorative transforms, and animations.
- [ ] Pass direction to carousels/sliders.
- [ ] Add `dir="ltr"` for phone numbers/code/IDs inside RTL pages when needed.

## 11. CMS integration, if applicable

- [ ] Derive CMS locales from i18n config.
- [ ] Set CMS default locale from i18n default.
- [ ] Mark editor-managed display fields localized.
- [ ] Keep stable identifiers generally unlocalized.
- [ ] Query collections/globals with locale.
- [ ] Include locale in cache keys.
- [ ] Verify admin UI still works outside frontend locale middleware.
- [ ] Regenerate CMS types if required.

## 12. Validation

- [ ] Run message key parity script.
- [ ] Run type check.
- [ ] Run lint.
- [ ] Start dev server.
- [ ] Visit each locale root.
- [ ] Visit nested and dynamic routes in each locale.
- [ ] Visit invalid locale and verify expected 404/redirect.
- [ ] Test language switcher from root, nested route, and dynamic route.
- [ ] Verify internal links preserve current locale.
- [ ] Verify external/anchor links are not localized.
- [ ] Inspect `<html lang>` and `<html dir>`.
- [ ] Check RTL header, mobile drawer, icons, carousels, and forms.
- [ ] Check canonical/Open Graph URLs.
- [ ] For CMS apps, verify localized content does not leak across locales.

## 13. Final review questions

- [ ] Are supported locales and default locale documented?
- [ ] Are localized and unlocalized route trees clear?
- [ ] Is there a single locale source of truth?
- [ ] Does every locale-dependent cache include locale?
- [ ] Does metadata follow the same URL policy as routing?
- [ ] Does the language switcher avoid manual path rewriting?
- [ ] Are project-specific labels, fonts, CMS fields, and exclusions adapted rather than copied?
