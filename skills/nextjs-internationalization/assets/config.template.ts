/**
 * Internationalization Configuration
 *
 * Replace locale values with the project's supported locales. Keep this file as
 * the single source of truth for routing, switchers, direction, and optional CMS
 * localization config.
 */

export type Locale = "en" | "ar"

export interface LocaleConfig {
  code: Locale
  name: string
  nativeName: string
  direction: "ltr" | "rtl"
  flag?: string
}

export const locales: LocaleConfig[] = [
  {
    code: "en",
    name: "English",
    nativeName: "English",
    direction: "ltr",
    flag: "🇺🇸",
  },
  {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    direction: "rtl",
    flag: "🇩🇿",
  },
]

export const defaultLocale: Locale = "en"

export const localeCodes: Locale[] = locales.map((locale) => locale.code)

// Backwards-compatible alias only if an existing project already used it.
export const localesCodes = localeCodes

// Optional Payload CMS localization config. Delete or adapt for other CMSs.
export const payloadLocales = locales.map(({ code, direction, name }) => ({
  code,
  label: name,
  rtl: direction === "rtl",
}))

export function isRTL(locale: Locale): boolean {
  return locales.find((item) => item.code === locale)?.direction === "rtl"
}

export function getDirection(locale: Locale): "ltr" | "rtl" {
  return isRTL(locale) ? "rtl" : "ltr"
}

export function getLocaleConfig(locale: Locale): LocaleConfig | undefined {
  return locales.find((item) => item.code === locale)
}

export function isValidLocale(locale: string): locale is Locale {
  return localeCodes.includes(locale as Locale)
}
