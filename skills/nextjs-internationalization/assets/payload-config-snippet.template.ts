// Payload CMS localization integration. Adapt or delete if the project does not use Payload.

import { defaultLocale, payloadLocales } from "./lib/i18n/config"

export default buildConfig({
  localization: {
    locales: payloadLocales,
    defaultLocale,
    fallback: true,
  },

  // collections, globals, editor, db, etc.
})

// Field convention:
// - localized: true for human-authored display content.
// - usually not localized for stable names, slugs, booleans, sort order, media relationships.
export const exampleLocalizedFields = [
  {
    name: "title",
    type: "text",
    localized: true,
    required: true,
  },
  {
    name: "description",
    type: "textarea",
    localized: true,
  },
]

// Query/cache convention:
async function getPageBySlug(slug: string, locale: Config["locale"]) {
  const payload = await getPayload({ config: configPromise })
  const { docs } = await payload.find({
    collection: "pages",
    locale,
    limit: 1,
    where: { slug: { equals: slug } },
  })

  return docs[0] || null
}

export const getCachedPageBySlug = (slug: string, locale: Config["locale"]) =>
  unstable_cache(() => getPageBySlug(slug, locale), [slug, locale], {
    tags: ["collection_pages", `page_${slug}`],
  })
