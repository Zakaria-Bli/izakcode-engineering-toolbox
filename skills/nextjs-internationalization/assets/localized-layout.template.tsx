import { notFound } from "next/navigation"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { getMessages, setRequestLocale } from "next-intl/server"

import { getDirection, routing } from "@/lib/i18n"

import type { Metadata } from "next"
import type { ReactNode } from "react"

import "../styles.css"

// Use this only when runtime data prevents static rendering.
// export const dynamic = 'force-dynamic'

type LayoutParams = Promise<{ locale?: string }>

type RootLayoutProps = {
  children: ReactNode
  params: LayoutParams
}

type MetadataProps = {
  params: LayoutParams
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: MetadataProps): Promise<Metadata> {
  const { locale: requestedLocale } = await params
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale

  return {
    title: locale === routing.defaultLocale ? "Default site title" : "Localized site title",
    description: "Replace with localized site description or CMS-backed metadata.",
  }
}

export default async function RootLayout({ children, params }: RootLayoutProps) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)
  const messages = await getMessages()

  return (
    <html lang={locale} dir={getDirection(locale)}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
