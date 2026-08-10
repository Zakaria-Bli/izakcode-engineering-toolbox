/**
 * Next.js middleware for next-intl locale routing.
 * Use this file name for Next.js 15 and earlier unless the project already uses proxy.ts.
 */

import createMiddleware from "next-intl/middleware"

import { routing } from "./lib/i18n/routing"

export default createMiddleware(routing)

export const config = {
  matcher: [
    // Match public frontend pathnames except:
    // - API routes
    // - admin/CMS routes
    // - custom non-localized route handlers
    // - Next.js internals and static files
    "/((?!api|trpc|admin|_next|_vercel|.*\\..*).*)",
  ],
}
