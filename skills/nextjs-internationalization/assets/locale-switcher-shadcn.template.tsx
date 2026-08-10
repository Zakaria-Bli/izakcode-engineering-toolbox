"use client"

import { ChevronDown, GlobeIcon } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useTransition } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { locales, type Locale } from "@/lib/i18n/config"
import { Link, usePathname } from "@/lib/i18n/navigation"
import { cn } from "@/lib/utils"

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
        className={cn(
          "group inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          isPending && "pointer-events-none opacity-50",
          className
        )}
        aria-label={`${t("toggleLanguage")}: ${otherLocale.nativeName}`}
        onClick={() => startTransition(() => {})}
      >
        {otherLocale.flag ? (
          <span
            className="text-lg transition-transform group-hover:scale-110"
            role="img"
            aria-label={otherLocale.name}
          >
            {otherLocale.flag}
          </span>
        ) : null}
        {showLabel && (
          <>
            <span className="hidden sm:inline" dir={otherLocale.direction}>
              {otherLocale.nativeName}
            </span>
            <span className="sm:hidden" dir={otherLocale.direction}>
              {otherLocale.code.toUpperCase()}
            </span>
          </>
        )}
        <GlobeIcon className="h-4 w-4" aria-hidden="true" />
      </Link>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
            className
          )}
          aria-label={`${t("toggleLanguage")}: ${currentLocale.nativeName}`}
          disabled={isPending}
        >
          {currentLocale.flag ? (
            <span className="text-xl" role="img" aria-label={currentLocale.name}>
              {currentLocale.flag}
            </span>
          ) : null}
          {showLabel && (
            <>
              <span className="hidden sm:inline" dir={currentLocale.direction}>
                {currentLocale.nativeName}
              </span>
              <span className="sm:hidden" dir={currentLocale.direction}>
                {currentLocale.code.toUpperCase()}
              </span>
            </>
          )}
          <ChevronDown className="h-4 w-4 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-40">
        {locales.map((localeOption) => (
          <DropdownMenuItem key={localeOption.code} asChild disabled={localeOption.code === locale}>
            <Link
              href={pathname || "/"}
              locale={localeOption.code}
              scroll={false}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2",
                localeOption.code === locale && "bg-accent"
              )}
              aria-label={`${t("toggleLanguage")}: ${localeOption.nativeName}`}
              aria-current={localeOption.code === locale ? "true" : undefined}
              onClick={() => startTransition(() => {})}
            >
              {localeOption.flag ? (
                <span className="text-xl" role="img" aria-label={localeOption.name}>
                  {localeOption.flag}
                </span>
              ) : null}
              <span className="flex-1" dir={localeOption.direction}>
                {localeOption.nativeName}
              </span>
              {localeOption.code === locale ? (
                <span className="text-xs opacity-70" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
