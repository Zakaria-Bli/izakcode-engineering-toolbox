"use client"

import { useLocale, useTranslations } from "next-intl"
import { useTransition } from "react"

import { locales, type Locale } from "@/lib/i18n/config"
import { Link, usePathname } from "@/lib/i18n/navigation"

type LocaleSwitcherProps = {
  className?: string
  variant?: "toggle" | "dropdown"
  showLabel?: boolean
}

export default function LocaleSwitcher({
  className = "",
  variant = "toggle",
  showLabel = true,
}: LocaleSwitcherProps) {
  const [isPending, startTransition] = useTransition()
  const t = useTranslations("common")
  const locale = useLocale() as Locale
  const pathname = usePathname()

  const currentLocale = locales.find((item) => item.code === locale) || locales[0]
  const otherLocale = locales.find((item) => item.code !== locale)

  if (variant === "toggle" && locales.length === 2 && otherLocale) {
    return (
      <Link
        href={pathname || "/"}
        locale={otherLocale.code}
        scroll={false}
        className={[
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
          "transition-colors hover:bg-accent hover:text-accent-foreground",
          isPending ? "pointer-events-none opacity-50" : "",
          className,
        ].join(" ")}
        aria-label={`${t("toggleLanguage")}: ${otherLocale.nativeName}`}
        onClick={() => startTransition(() => {})}
      >
        {otherLocale.flag ? (
          <span role="img" aria-label={otherLocale.name}>
            {otherLocale.flag}
          </span>
        ) : null}
        {showLabel ? <span dir={otherLocale.direction}>{otherLocale.nativeName}</span> : null}
      </Link>
    )
  }

  return (
    <details className={["relative inline-block", className].join(" ")}>
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
        aria-label={`${t("toggleLanguage")}: ${currentLocale.nativeName}`}
      >
        {currentLocale.flag ? (
          <span role="img" aria-label={currentLocale.name}>
            {currentLocale.flag}
          </span>
        ) : null}
        {showLabel ? <span dir={currentLocale.direction}>{currentLocale.nativeName}</span> : null}
      </summary>

      <ul className="absolute end-0 z-50 mt-2 min-w-40 rounded-md border bg-background p-1 shadow-lg">
        {locales.map((localeOption) => (
          <li key={localeOption.code}>
            <Link
              href={pathname || "/"}
              locale={localeOption.code}
              scroll={false}
              className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
              aria-label={`${t("toggleLanguage")}: ${localeOption.nativeName}`}
              aria-current={localeOption.code === locale ? "true" : undefined}
              onClick={() => startTransition(() => {})}
            >
              {localeOption.flag ? (
                <span role="img" aria-label={localeOption.name}>
                  {localeOption.flag}
                </span>
              ) : null}
              <span className="flex-1" dir={localeOption.direction}>
                {localeOption.nativeName}
              </span>
              {localeOption.code === locale ? <span aria-hidden="true">✓</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}
