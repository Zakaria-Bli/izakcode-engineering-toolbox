import { defineConfig } from "eslint/config"
import eslintConfigPrettier from "eslint-config-prettier"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import tseslint from "typescript-eslint"

import { config as baseConfig } from "./base.js"

/**
 * A shared ESLint configuration for TypeScript code.
 *
 * This config is intentionally not type-aware yet. Package-level configs can
 * add type-aware rules later when they have their own tsconfig.json.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = defineConfig(
  baseConfig,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/exports": "error",
      "simple-import-sort/imports": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
      ],
    },
  },
  eslintConfigPrettier
)
