import { defineConfig } from "vitest/config"

/**
 * Shared Vitest configuration for Node-oriented tests.
 *
 * Package-level configs can extend this and override environment/include rules
 * when they need browser, DOM, or framework-specific behavior.
 */
export const config = defineConfig({
  test: {
    environment: "node",
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    include: [
      "**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
      "**/__tests__/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.next/**",
      "**/.output/**",
      "**/.vercel/**",
    ],
  },
})
