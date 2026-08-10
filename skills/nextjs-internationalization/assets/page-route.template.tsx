import { notFound } from "next/navigation"

import { getPageMetadata } from "@/lib/seo"

import type { Locale } from "@/lib/i18n/config"
import type { Metadata } from "next"

type PageProps = {
  params: Promise<{ locale: Locale; slug?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const pathname = slug ? `/${slug}` : "/"

  // Replace with project data source. Always pass locale into localized content fetches.
  const page = await getLocalizedPageBySlug(slug || "home", locale)
  const siteSettings = await getLocalizedSiteSettings(locale)

  if (!page) {
    notFound()
  }

  return getPageMetadata({ page, siteSettings, locale, pathname })
}

export default async function Page({ params }: PageProps) {
  const { locale, slug } = await params
  const page = await getLocalizedPageBySlug(slug || "home", locale)

  if (!page) {
    notFound()
  }

  return <main>{/* Render page with locale-aware content. */}</main>
}

async function getLocalizedPageBySlug(slug: string, locale: Locale) {
  void slug
  void locale
  return null as any
}

async function getLocalizedSiteSettings(locale: Locale) {
  void locale
  return null as any
}
