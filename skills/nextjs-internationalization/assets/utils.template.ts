/**
 * I18n utility functions.
 */

import { Locale, getDirection, getLocaleConfig, isRTL } from "./config"

export function getFontClassName(locale: Locale): string {
  return isRTL(locale) ? "font-arabic" : "font-latin"
}

export function getLocaleDisplayName(locale: Locale): string {
  return getLocaleConfig(locale)?.nativeName || locale
}

export function getOppositeDirection(locale: Locale): "ltr" | "rtl" | undefined {
  const direction = getDirection(locale)
  return direction === "rtl" ? "ltr" : "rtl"
}

export { getDirection, isRTL }
