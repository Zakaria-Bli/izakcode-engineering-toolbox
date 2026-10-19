---
name: layered-feature-scaffold
description: Scaffolds a new feature/domain folder (controllers, services, repo, domain types, validation schemas, gateways, and a public index.ts) following the Pragmatic Layered Architecture — a lightweight controller/service/repo separation for Next.js, Express, Nest, and similar TypeScript backends — and sets up ESLint import-boundary enforcement for it. Use this whenever the user wants to add a new feature, domain, or module to a codebase that follows (or should follow) this layered pattern — e.g. "add a new orders feature", "set up the files for a payments domain", "scaffold the auth feature", "create a new feature folder for reviews" — even if they don't explicitly say "scaffold" or name the architecture. Also use this to check whether existing code in `.controllers.ts`, `.services.ts`, `.repo.ts`, `.domain.ts`, or `.gateway.ts` files respects the layer boundaries (reviewing a PR, "does this violate the architecture", "where should this logic live", "can feature A call feature B", transactions or error handling across layers), or to add lint rules that enforce those boundaries.
---

# Layered Feature Scaffold

This skill generates the file skeleton for a new feature under the **Pragmatic Layered
Architecture**: a minimal, framework-agnostic separation between transport (controllers), use
cases (services), and persistence (repos), strict enough to prevent architectural drift but light
enough not to slow down day-to-day feature work.

## What's in the skill, and when to read it

- `references/pragmatic-layered-architecture-rule.md` — the compact rule (~80 lines). Read it
  first for any review or "where does this go" question; it has every boundary and a quick
  reference table. It's also written to be **installed** as an always-on project rule (Cursor
  rules, `AGENTS.md`/`CLAUDE.md`, or another agent rules folder) — its frontmatter is for those
  tools and does nothing while it sits inside this skill.
- `references/pragmatic-layered-architecture.md` — the full reference: rationale, worked
  examples, effects ownership, transactions, persistence errors, cross-feature rules, framework
  placement (Next.js, Express, Nest), testing, anti-patterns. Read the relevant section whenever
  you need to explain _why_ a boundary exists, decide an edge case, or justify a review comment.
  It has a table of contents; don't load all of it for a simple question.
- `assets/eslint-boundaries.template.mjs` — a tested ESLint flat config that enforces the
  boundaries (deep cross-feature imports, controller→repo, ORM outside repos, framework imports in
  services, barrels leaking controllers). Copy and adapt it when setting up a repo.
- `scripts/scaffold_feature.py` — generates the feature files.
- `scripts/selftest.sh` — maintainer check: scaffolds into a temp project, type-checks it, and
  runs the ESLint template against deliberate violations. Run it after changing the templates or
  the ESLint config; it needs network access to install pinned packages.

## When to scaffold vs. when to just explain

- The user wants new files for a feature → scaffold (below).
- The user has existing code and wants to know if it follows the architecture, or where some
  logic should live → read the rule (and the relevant full-reference section) and answer
  directly; no script needed. Cite the specific boundary, and suggest the concrete move ("this
  `sendEmail` call belongs in `registerUser` in `auth.services.ts`").

## Before scaffolding: confirm the project-specific details

Don't guess — check the repo first, then ask if still unclear:

1. **Base features path.** Look for an existing `features/` directory (`src/features`,
   `features`, `app/features`).
2. **Feature name.** Singular, e.g. `order`, not `orders`.
3. **Import alias for the shared lib.** Check `tsconfig.json` `paths` (e.g. `"@/*": ["./src/*"]`
   means `--lib-import @/lib`). Without it, the script writes relative imports, which always
   compile but read worse.
4. **Existing shared helpers.** If the project already has a transaction helper or persistence
   error types, pass `--no-shared` and point the generated imports at what exists instead of
   creating a second version.

## Running the scaffold

```bash
python3 scripts/scaffold_feature.py --feature order --path src/features --lib-import @/lib
```

This creates (shared files only if they don't exist yet):

```
src/features/order/
  order.controllers.ts      # transport adapter, imported by routes only
  order.services.ts         # use cases: getOrder, createOrder
  order.repo.ts             # findOrderById, insertOrder, re-exports withTransaction/Tx
  order.domain.ts           # Order, OrderNotFoundError, OrderForbiddenError
  lib/
    order.validations.ts
  index.ts                  # public API: use cases + types + errors
src/lib/
  transaction.repo.ts       # withTransaction + opaque Tx
  persistence-errors.core.ts
```

Each file comes pre-wired (controller → service → repo, domain types and errors flowing through,
`tx` threaded through the use cases) with `TODO` markers where real logic goes. It saves the
boilerplate, not the business logic. Note the naming: repos use storage verbs (`insertOrder`,
`findOrderById`), services use use-case names (`createOrder`, `getOrder`), controllers add
`Action` (`createOrderAction`) — so nothing collides when a file imports from the layer below.

**Optional: third-party gateway.** Only when the user needs external I/O from this feature (a
mailer, Stripe, a webhook) — not every feature does:

```bash
python3 scripts/scaffold_feature.py --feature order --path src/features --gateway mailer
python3 scripts/scaffold_feature.py --feature order --path src/features --gateway stripe --gateway-scope shared
```

Local scope writes `src/features/order/lib/mailer.gateway.ts` (a wrapper with feature-specific
config); shared scope writes `src/lib/stripe.gateway.ts` (used by 2+ features). `--client` and
`--client-scope` still work as deprecated aliases.

Other flags: `--lib-path` to put shared files somewhere other than `lib/` next to the features
folder; `--force` to overwrite existing files. By default the script skips existing files, so
re-running it only fills in what's missing. Confirm with the user before `--force` — it discards
whatever's there.

## After scaffolding

Point out what's still a `TODO` (domain fields, the ORM wiring in `transaction.repo.ts`, the
actual queries, the input schema, business rules, error mapping) rather than presenting the
feature as complete. If the user's request included concrete details — field names, a validation
rule, a query, a business rule — fill them in over the placeholders, since you have what's needed.

Mention how to wire it up: routes (Next.js pages/route handlers/server actions, Express routers)
import `order.controllers.ts` directly; other features import from `features/order` (its
`index.ts`) only.

**First feature in a repo?** Offer two one-time setup steps: install the compact rule into the
project's agent rules location, and add the ESLint boundaries config (adjust its `PROJECT LAYOUT`
block to the repo's folders and the ORM/framework packages it uses). Don't add them without
asking — they change the project's tooling.

**Cross-feature dependency** (feature A needs feature B): A's service imports B's use cases,
types, and errors from B's `index.ts`. If A needs B's write inside its own transaction, it passes
its `tx` to B's use case. A never imports B's repo or controllers — if B's `index.ts` doesn't
export what A needs, add a use case to B rather than reaching in.

## Projects on the older convention

Earlier versions of this architecture exported side-effect-free **controller** functions from
`index.ts` and named third-party wrappers `*.client.ts`. When reviewing such code, flag both and
suggest the migration: re-export the underlying service functions from `index.ts` instead of
controllers, and rename `*.client.ts` → `*.gateway.ts` (in Remix/React Router, `.client.ts` files
are dropped from the server bundle). Don't rewrite a whole codebase unprompted — note it and let
the user decide.
