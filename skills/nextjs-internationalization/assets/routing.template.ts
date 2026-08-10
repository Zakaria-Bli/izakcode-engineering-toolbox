/**
 * Routing Configuration for next-intl
 */

import { defineRouting } from "next-intl/routing"

import { defaultLocale, localeCodes } from "./config"

export const routing = defineRouting({
  locales: localeCodes,
  defaultLocale,

  // Source architecture uses explicit prefixes for every locale:
  // /en/about, /ar/about, including the default locale.
  // Change only if product requirements demand a different URL policy.
  localePrefix: "always",

  // Optional: add localized pathname mappings here if routes themselves are translated.
  // pathnames: {
  //   '/about': {
  //     en: '/about',
  //     ar: '/about-us-in-arabic'
  //   }
  // }
})
