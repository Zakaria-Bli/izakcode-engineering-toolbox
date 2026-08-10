/**
 * Type-safe, locale-aware navigation utilities for next-intl.
 * Import internal app links from this file instead of next/link.
 */

import { createNavigation } from "next-intl/navigation"

import { routing } from "./routing"

export const { Link, redirect, usePathname, useRouter } = createNavigation(routing)
