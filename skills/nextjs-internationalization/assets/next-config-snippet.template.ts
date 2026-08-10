import createNextIntlPlugin from "next-intl/plugin"

import type { NextConfig } from "next"

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts")

const nextConfig: NextConfig = {
  // Preserve existing config here.
}

// Compose with existing wrappers instead of replacing them.
// Example with another wrapper:
// export default withNextIntl(withOtherPlugin(nextConfig))
export default withNextIntl(nextConfig)
