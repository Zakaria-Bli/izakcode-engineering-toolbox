import type { Locale } from "@/lib/i18n/config"
import type { Metadata } from "next"

function getSiteURL() {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
}

// This helper assumes routing.localePrefix === 'always'.
// Adapt if using 'as-needed' or custom localized pathnames.
export function getLocalizedPath(pathname: string, locale: Locale) {
  if (!pathname || pathname === "/") {
    return `/${locale}`
  }

  return `/${locale}${pathname}`
}

function withSiteName(title: string, siteName: string) {
  if (!title || title === siteName) {
    return siteName
  }

  return `${title} | ${siteName}`
}

export function buildLocalizedMetadata({
  title,
  description,
  image,
  locale,
  pathname,
  noIndex,
  siteName,
}: {
  title: string
  description: string
  image?: string
  locale: Locale
  pathname: string
  noIndex?: boolean | null
  siteName: string
}): Metadata {
  const localizedPath = getLocalizedPath(pathname, locale)
  const url = new URL(localizedPath, getSiteURL()).toString()

  return {
    title: withSiteName(title, siteName),
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: withSiteName(title, siteName),
      description,
      url,
      siteName,
      locale,
      type: "website",
      images: image ? [{ url: new URL(image, getSiteURL()).toString() }] : undefined,
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : undefined,
  }
}
