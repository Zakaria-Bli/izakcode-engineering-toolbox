// eslint-boundaries.template.mjs
// Pragmatic Layered Architecture import boundaries for ESLint flat config.
//
// Install (versions this template is tested against):
//   npm i -D eslint@^10 eslint-plugin-boundaries@^7.2.0 eslint-import-resolver-typescript@^4.4.5
//
// Use: copy into the project (e.g. eslint.boundaries.mjs), adjust the
// PROJECT LAYOUT block below, then spread it into eslint.config.mjs:
//   import boundariesConfig from "./eslint.boundaries.mjs"
//   export default [...yourConfig, ...boundariesConfig]
//
// Why a plugin instead of no-restricted-imports: imports are resolved to real
// files through tsconfig paths, so `@/features/order/order.repo` and
// `../order/order.repo` are the same edge; `export ... from` re-exports are
// checked too, so a barrel can't leak a forbidden module; and because every
// edge is checked, a forbidden module can't arrive transitively either.

import boundaries from "eslint-plugin-boundaries"

// ---- PROJECT LAYOUT (adjust) ----------------------------------------------

// Folders holding one folder per feature (matched as a path suffix).
const FEATURES = "features/*"

// Shared lib folders, from the project root (transaction.repo.ts, gateways,
// .core.ts / .server.ts utilities).
const SHARED_LIB = ["lib", "src/lib"]

// Routing layer, from the project root: the only code allowed to import
// *.controllers.ts. Next.js app/ router shown; add Express router folders.
const ROUTING = ["app", "src/app", "src/routes"]

// Transport/framework modules that only controllers, .server.ts files and the
// routing layer may import (cookies, headers, redirects, request objects).
const FRAMEWORK_TRANSPORT = [
  { source: "next", internalPath: ["headers", "navigation", "server", "cache"] },
  { source: "express" },
]

// ORM / driver packages: only *.repo.ts files may import these.
const ORM_PACKAGES = [
  "@prisma/client",
  "drizzle-orm",
  "kysely",
  "typeorm",
  "mongoose",
  "sequelize",
  "knex",
  "pg",
  "mysql2",
  "better-sqlite3",
]

// ---------------------------------------------------------------------------

const framework = FRAMEWORK_TRANSPORT.map((module) => ({
  module: { origin: "external", ...module },
}))
const orm = { module: { origin: "external", source: ORM_PACKAGES } }

const featureApi = { element: { type: "feature", fileInternalPath: "index.ts" } }
const sameFeature = { type: "feature", captured: { feature: "{{from.element.captured.feature}}" } }
const layer = (categories) => ({ file: { categories } })

export default [
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
      },
      "boundaries/legacy-templates": false,
      // Check re-exports and dynamic imports as well as plain imports.
      "boundaries/dependency-nodes": ["import", "export", "dynamic-import"],
      // Tests may reach into the layer they test.
      "boundaries/ignore": ["**/*.{test,spec}.{ts,tsx}", "**/__tests__/**"],
      "boundaries/elements": [
        { type: "feature", pattern: FEATURES, capture: ["feature"] },
        { type: "shared-lib", pattern: SHARED_LIB, partialMatch: false },
        { type: "routing", pattern: ROUTING, partialMatch: false },
      ],
      // Layers are file suffixes, so they apply in features and shared lib alike.
      "boundaries/files": [
        { category: "controllers", pattern: "**/*.controllers.ts" },
        { category: "services", pattern: "**/*.services.ts" },
        { category: "repo", pattern: "**/*.repo.ts" },
        { category: "domain", pattern: "**/*.domain.ts" },
        { category: "validations", pattern: "**/*.validations.ts" },
        { category: "gateway", pattern: "**/*.gateway.ts" },
        { category: "core", pattern: "**/*.core.ts" },
        { category: "server", pattern: "**/*.server.ts" },
        // Catch-all (categories accumulate): the plugin skips files with no
        // element and no category, and UI components, hooks, etc. must not
        // reach into feature internals either.
        { category: "source", pattern: "**/*.{ts,tsx,mts,cts}" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          // Only the layer rules below are enforced; code outside these
          // elements (UI components, scripts, the db client) is left alone
          // except where a policy names it.
          default: "allow",
          checkAllOrigins: true, // needed for the ORM/framework module rules
          checkInternals: true, // apply layer rules inside a feature too
          // Last matching policy wins, so specific allows follow broad denies.
          policies: [
            // Feature internals are private: from outside a feature, only its
            // index.ts is importable -- except the routing layer, which
            // imports controllers.
            {
              disallow: { to: { element: { type: "feature" } } },
            },
            {
              allow: { to: featureApi },
            },
            {
              from: { element: { type: "feature" } },
              allow: { to: { element: sameFeature } },
            },
            {
              from: { element: { type: "routing" } },
              allow: { to: { element: { type: "feature" }, ...layer("controllers") } },
            },

            // index.ts is the transport-independent public API: use cases,
            // domain types, errors, value objects. Never controllers or repos.
            {
              from: featureApi,
              disallow: { to: layer(["controllers", "repo", "server"]) },
            },

            // Controllers call use cases, never repos (not even for reads).
            {
              from: layer("controllers"),
              disallow: { to: layer("repo") },
            },

            // Services: no controllers, no framework-bound utilities, no
            // transport APIs.
            {
              from: layer("services"),
              disallow: { to: [layer(["controllers", "server"]), ...framework] },
            },

            // Repos sit at the bottom: they don't call back up the stack.
            {
              from: layer("repo"),
              disallow: { to: [layer(["controllers", "services", "gateway"]), featureApi] },
            },

            // Domain files and pure utilities: no I/O, no framework.
            {
              from: layer(["domain", "core"]),
              disallow: {
                to: [layer(["controllers", "services", "repo", "gateway", "server"]), ...framework],
              },
            },

            // Gateways wrap third-party I/O only.
            {
              from: layer("gateway"),
              disallow: {
                to: [layer(["controllers", "services", "repo"]), featureApi, ...framework],
              },
            },

            // Only repos may touch the ORM. (The db client setup itself, e.g.
            // src/db/index.ts, carries no layer suffix and is unaffected.)
            {
              from: [
                layer([
                  "controllers",
                  "services",
                  "domain",
                  "validations",
                  "gateway",
                  "core",
                  "server",
                ]),
                { element: { type: "routing" } },
              ],
              disallow: { to: orm },
            },
          ],
        },
      ],
    },
  },
]
