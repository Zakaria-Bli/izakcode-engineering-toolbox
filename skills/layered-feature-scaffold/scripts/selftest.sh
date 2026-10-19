#!/usr/bin/env bash
# Self-test for this skill's tooling. Builds a throwaway TypeScript project,
# scaffolds features with scaffold_feature.py, type-checks them under strict
# tsc, then runs assets/eslint-boundaries.template.mjs against the scaffold
# plus deliberate violations and asserts each file is flagged (or clean) as
# expected. Run after changing the scaffold templates or the ESLint template.
#
# Usage: bash scripts/selftest.sh [--keep]
# Needs node/npm and network access (installs pinned devDependencies into a
# temp dir). --keep leaves the temp project behind for inspection.

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAB="$(mktemp -d "${TMPDIR:-/tmp}/layered-selftest.XXXXXX")"
if [[ "${1:-}" == "--keep" ]]; then
  echo "Keeping test project at $LAB"
else
  trap 'rm -rf "$LAB"' EXIT
fi
cd "$LAB"

echo "==> Installing pinned tooling"
npm init -y >/dev/null
npm i -D --no-audit --no-fund --silent \
  eslint@10.10.0 eslint-plugin-boundaries@7.2.0 eslint-import-resolver-typescript@4.4.5 \
  typescript-eslint@8.70.0 typescript@5.9.3 zod@3.25.76

# Stub external packages so they resolve as real external modules.
for pkg in next drizzle-orm; do
  mkdir -p "node_modules/$pkg"
  printf '{"name":"%s","version":"0.0.0","main":"index.js"}\n' "$pkg" >"node_modules/$pkg/package.json"
  echo "module.exports = {}" >"node_modules/$pkg/index.js"
done
echo "export declare function cookies(): unknown" >node_modules/next/headers.d.ts
echo "module.exports = { cookies() {} }" >node_modules/next/headers.js
echo "export declare const sql: unknown" >node_modules/drizzle-orm/index.d.ts

cat >tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true, "jsx": "preserve",
    "baseUrl": ".", "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
EOF

echo "==> Scaffolding features"
SCAFFOLD="$SKILL_DIR/scripts/scaffold_feature.py"
python3 "$SCAFFOLD" --feature order --path src/features --lib-import @/lib --gateway mailer >/dev/null
python3 "$SCAFFOLD" --feature customer-account --path src/features --gateway stripe --gateway-scope shared >/dev/null
python3 "$SCAFFOLD" --feature invoice --path src/features --lib-import @/lib >/dev/null

echo "==> Type-checking the scaffold (strict)"
npx tsc -p .

echo "==> Writing lint fixtures"
put() { mkdir -p "$(dirname "$1")"; cat >"$1"; }
F=src/features

# Violations: each file below must be flagged.
put $F/order/order-bad-read.controllers.ts <<'EOF'
import { findOrderById } from "./order.repo"
export const v = findOrderById
EOF
put $F/order/order-bad-framework.services.ts <<'EOF'
import { cookies } from "next/headers"
export const v = cookies
EOF
put src/lib/session.server.ts <<'EOF'
export function readSession(): string | null { return null }
EOF
put $F/order/order-bad-server.services.ts <<'EOF'
import { readSession } from "@/lib/session.server"
export const v = readSession
EOF
put $F/customer-account/customer-account-bad-alias.services.ts <<'EOF'
import { getOrder } from "@/features/order/order.services"
export const v = getOrder
EOF
put $F/customer-account/customer-account-bad-relative.services.ts <<'EOF'
import { findOrderById } from "../order/order.repo"
export const v = findOrderById
EOF
put $F/customer-account/customer-account-bad-controllers.services.ts <<'EOF'
import { getOrderAction } from "@/features/order/order.controllers"
export const v = getOrderAction
EOF
put $F/customer-account/customer-account-bad-dynamic.services.ts <<'EOF'
export async function v() { return import("@/features/order/order.repo") }
EOF
echo 'export { getInvoiceAction } from "./invoice.controllers"' >>$F/invoice/index.ts
put $F/order/order-bad-orm.services.ts <<'EOF'
import { sql } from "drizzle-orm"
export const v = sql
EOF
put $F/order/order-bad-orm.domain.ts <<'EOF'
import { sql } from "drizzle-orm"
export const v = sql
EOF
put $F/order/order-bad-io.domain.ts <<'EOF'
import { findOrderById } from "./order.repo"
export const v = findOrderById
EOF
put $F/order/order-bad-up.repo.ts <<'EOF'
import { getOrder } from "./order.services"
export const v = getOrder
EOF
put src/components/OrderCardBad.tsx <<'EOF'
import type { Order } from "@/features/order/order.domain"
export type V = Order
EOF
put src/app/orders/bad-route.ts <<'EOF'
import { getOrder } from "@/features/order/order.services"
export const v = getOrder
EOF

# Allowed: each file below must stay clean (as must the whole scaffold).
put src/app/orders/page.ts <<'EOF'
import type { Order } from "@/features/order"
import { getOrderAction } from "@/features/order/order.controllers"
export async function Page(id: number): Promise<Order> { return getOrderAction(id) }
EOF
put $F/customer-account/customer-account-ok.services.ts <<'EOF'
import { createOrder, OrderNotFoundError } from "@/features/order"
import { type Tx, withTransaction } from "./customer-account.repo"
export async function signUpWithFirstOrder(tx?: Tx) {
  return withTransaction(async (activeTx) => createOrder({}, activeTx), tx)
}
export const e = OrderNotFoundError
EOF
put src/components/OrderCardOk.tsx <<'EOF'
import { type Order, OrderNotFoundError } from "@/features/order"
export type V = Order
export const e = OrderNotFoundError
EOF
put src/db/index.ts <<'EOF'
import { sql } from "drizzle-orm"
export const db = sql
EOF
put $F/order/order-orm.repo.ts <<'EOF'
import { sql } from "drizzle-orm"
export const v = sql
EOF
put $F/order/order.services.test.ts <<'EOF'
import { findOrderById } from "./order.repo"
export const v = findOrderById
EOF
put $F/order/order-ok.controllers.ts <<'EOF'
import { cookies } from "next/headers"
import { readSession } from "@/lib/session.server"
import { getOrder } from "./order.services"
export async function meAction() { cookies(); readSession(); return getOrder(1) }
EOF

cp "$SKILL_DIR/assets/eslint-boundaries.template.mjs" eslint.boundaries.mjs
cat >eslint.config.mjs <<'EOF'
import tseslint from "typescript-eslint"
import boundariesConfig from "./eslint.boundaries.mjs"
export default [
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser } },
  ...boundariesConfig,
]
EOF

echo "==> Linting"
npx eslint src -f json -o result.json || true

node - <<'EOF'
const results = require("./result.json")
const violations = new Set([
  "src/features/order/order-bad-read.controllers.ts",
  "src/features/order/order-bad-framework.services.ts",
  "src/features/order/order-bad-server.services.ts",
  "src/features/customer-account/customer-account-bad-alias.services.ts",
  "src/features/customer-account/customer-account-bad-relative.services.ts",
  "src/features/customer-account/customer-account-bad-controllers.services.ts",
  "src/features/customer-account/customer-account-bad-dynamic.services.ts",
  "src/features/invoice/index.ts",
  "src/features/order/order-bad-orm.services.ts",
  "src/features/order/order-bad-orm.domain.ts",
  "src/features/order/order-bad-io.domain.ts",
  "src/features/order/order-bad-up.repo.ts",
  "src/components/OrderCardBad.tsx",
  "src/app/orders/bad-route.ts",
])
let failures = 0
const linted = new Set()
for (const file of results) {
  const rel = file.filePath.slice(process.cwd().length + 1)
  linted.add(rel)
  const boundary = file.messages.filter((m) => m.ruleId === "boundaries/dependencies")
  const other = file.messages.filter((m) => m.ruleId !== "boundaries/dependencies")
  const expected = violations.has(rel)
  const ok = (expected ? boundary.length > 0 : boundary.length === 0) && other.length === 0
  if (!ok) {
    failures++
    const detail = [...boundary, ...other].map((m) => m.message).join(" | ") || "no boundary error"
    console.log(`FAIL ${expected ? "expected violation" : "expected clean"}: ${rel} -- ${detail}`)
  }
}
for (const rel of violations) {
  if (!linted.has(rel)) { failures++; console.log(`FAIL not linted: ${rel}`) }
}
console.log(failures ? `\n${failures} of ${results.length} files failed` : `All ${results.length} files behaved as expected (${violations.size} violations caught)`)
process.exit(failures ? 1 : 0)
EOF
