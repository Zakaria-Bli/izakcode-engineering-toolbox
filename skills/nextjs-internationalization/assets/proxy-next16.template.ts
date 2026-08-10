/**
 * Next.js 16 Proxy for next-intl locale routing.
 * Place at src/proxy.ts or proxy.ts depending on project structure.
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
