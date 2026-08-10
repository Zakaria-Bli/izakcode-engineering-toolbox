import { Link } from "@/lib/i18n/navigation"

import type { Locale } from "@/lib/i18n/config"

type LinkItem = {
  href: string
  label: string
  newTab?: boolean | null
}

function isNativeHref(href: string) {
  return /^(?:[a-z][a-z\d+\-.]*:|#)/i.test(href)
}

export function LocalizedNavLink({ item, locale }: { item: LinkItem; locale: Locale }) {
  const target = item.newTab ? "_blank" : undefined
  const rel = item.newTab ? "noopener noreferrer" : undefined
  const className = "transition-colors hover:text-primary"

  if (isNativeHref(item.href)) {
    return (
      <a href={item.href} target={target} rel={rel} className={className}>
        {item.label}
      </a>
    )
  }

  // item.href should be an unlocalized app path such as /projects.
  // next-intl applies the locale prefix according to routing.ts.
  return (
    <Link href={item.href} locale={locale} target={target} rel={rel} className={className}>
      {item.label}
    </Link>
  )
}
