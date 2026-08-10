---
name: layered-feature-scaffold
description: Scaffolds a new feature/domain folder (controllers, services, repo, domain types, validation schemas, and public index.ts) following the Pragmatic Layered Architecture — a lightweight controller/service/repo separation for Next.js, Express, Nest, and similar TypeScript backends. Use this whenever the user wants to add a new feature, domain, or module to a codebase that follows (or should follow) this layered pattern — e.g. "add a new orders feature", "set up the files for a payments domain", "scaffold the auth feature", "create a new feature folder for reviews" — even if they don't explicitly say "scaffold" or name the architecture. Also use this to check whether existing code in `.controllers.ts`, `.services.ts`, `.repo.ts`, or `.domain.ts` files respects the layer boundaries (e.g. reviewing a PR, checking "does this violate the architecture", asking why something should move to a service).
---

# Layered Feature Scaffold

This skill generates the file skeleton for a new feature under the **Pragmatic Layered
Architecture**: a minimal, framework-agnostic separation between controllers, business
logic, and persistence, designed to be strict enough to prevent architectural drift but
light enough not to slow down day-to-day feature work.

The full rule — including the reasoning behind each boundary, transactions, cross-feature
import rules, and testing guidance — lives in `references/pragmatic-layered-architecture.md`.
Read it whenever you need to explain _why_ a boundary exists, decide where a piece of logic
belongs, or review existing code for violations. Don't just skim this SKILL.md and guess —
the reference doc has the actual rules and the worked examples.

## When to scaffold vs. when to just explain

- If the user wants new files created for a feature → scaffold (see below).
- If the user has existing code and wants to know if it follows the architecture, or where
  a piece of logic should live → read `references/pragmatic-layered-architecture.md` and
  answer directly; no need to run the script.

## Before scaffolding: confirm the two project-specific details

The script needs two things that vary per project. Don't guess — ask if either is unclear
from the conversation or the codebase itself:

1. **Base features path.** Common conventions are `src/features`, `features`, or
   `app/features`. Check the existing repo structure first (look for a `features/` or
   similar directory) before asking.
2. **Feature name.** Whatever the user calls it — singular, e.g. `order`, not `orders`.

Everything else (file names, casing, boilerplate) is handled automatically.

## Running the scaffold

Use `scripts/scaffold_feature.py`:

```bash
python3 scripts/scaffold_feature.py --feature order --path src/features
```

This creates:

```
src/features/order/
  order.controllers.ts
  order.services.ts
  order.repo.ts
  order.domain.ts
  lib/
    order.validations.ts
  index.ts
```

Each file is pre-filled with imports wired to each other correctly (controller → service →
repo, domain types/errors flowing through) and `TODO` markers where real logic needs to go —
not empty files. This is meant to save the boilerplate-typing step, not to write the business
logic for the user.

**Optional: external client stub.** Only add this if the user asks for it (e.g. "I'll need to
call a mailer/stripe/webhook from here") — don't add it by default, since not every feature
needs third-party I/O:

```bash
python3 scripts/scaffold_feature.py --feature order --path src/features --client mailer
```

This additionally creates `src/features/order/lib/mailer.client.ts`.

**Re-running on an existing feature.** By default the script skips any file that already
exists, so it's safe to re-run if you only want to add the missing pieces (e.g. someone
forgot the `lib/validations.ts`). Pass `--force` only if the user explicitly wants existing
files overwritten — confirm with them first, since this discards whatever's already there.

## After scaffolding

Briefly point out what's still a `TODO` (domain fields, the actual query in the repo, the
input schema, business rules) rather than pretending the feature is complete. If the user's
request included any concrete detail — field names, a specific validation rule, an actual
query — go ahead and fill that in over the placeholder rather than leaving it as `TODO`,
since you already have the information needed.

If the user mentions this is a cross-feature dependency (feature A needs to call feature B),
remind them per the architecture doc: only side-effect-free exports from `index.ts` are
importable from other features. HTTP-bound controller handlers stay feature-private, and
`.services.ts` / `.repo.ts` are never exported across feature boundaries.
