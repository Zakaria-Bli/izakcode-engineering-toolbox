#!/usr/bin/env python3
"""
Scaffold a new feature folder following the Pragmatic Layered Architecture:
controllers / services / repo / domain / validations / index.ts

Usage:
    python scaffold_feature.py --feature order --path src/features
    python scaffold_feature.py --feature order --path src/features --client mailer
    python scaffold_feature.py --feature order --path src/features --force
"""

import argparse
import re
import sys
from pathlib import Path
from string import Template


def to_pascal_case(name: str) -> str:
    """order-item -> OrderItem, order_item -> OrderItem, order -> Order"""
    parts = re.split(r"[-_\s]+", name.strip())
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def to_camel_case(name: str) -> str:
    pascal = to_pascal_case(name)
    return pascal[:1].lower() + pascal[1:] if pascal else pascal


def to_kebab_case(name: str) -> str:
    """OrderItem / order_item / Order Item -> order-item"""
    s = re.sub(r"[_\s]+", "-", name.strip())
    s = re.sub(r"(?<!^)(?=[A-Z])", "-", s)
    return s.lower().strip("-")


# Templates use $Placeholder substitution (string.Template), not str.format(),
# since the generated TypeScript is full of literal { } braces that would
# collide with .format()'s escaping rules.

DOMAIN_TS = '''// $kebab.domain.ts
// Domain types & domain errors for the "$kebab" feature.
// This file is the feature's data contract -- no ORM types, no framework types.

export interface $Pascal {
  id: number
  // TODO: add domain fields
}

export class ${Pascal}NotFoundError extends Error {
  constructor(message = "$Pascal not found") {
    super(message)
    this.name = "${Pascal}NotFoundError"
  }
}

export class ${Pascal}ForbiddenError extends Error {
  constructor(message = "Not allowed to access this $kebab") {
    super(message)
    this.name = "${Pascal}ForbiddenError"
  }
}
'''

REPO_TS = '''// $kebab.repo.ts
// The only file that knows about the ORM for "$kebab".
// Map DB rows -> domain types here. No business logic, no thrown domain errors.

import type { $Pascal } from "./$kebab.domain"

// import { db } from "@/db" // TODO: uncomment and wire up your ORM
// import { ${camel}Table } from "@/db/schema"

export async function find${Pascal}ById(id: number): Promise<$Pascal | null> {
  // TODO: replace with real query
  // const row = await db.query.${camel}Table.findFirst({ where: eq(${camel}Table.id, id) })
  // return row ? mapRowTo$Pascal(row) : null
  throw new Error("find${Pascal}ById not implemented")
}

export async function create$Pascal(data: Omit<$Pascal, "id">): Promise<$Pascal> {
  // TODO: replace with real insert
  throw new Error("create$Pascal not implemented")
}

/**
 * Transaction boundary -- exposed here so services can compose multiple repo
 * calls atomically without importing the ORM directly.
 *
 * export async function withTransaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
 *   return db.transaction(fn)
 * }
 */

// function mapRowTo$Pascal(row: unknown): $Pascal {
//   // TODO: map ORM row -> domain type
// }
'''

SERVICES_TS = '''// $kebab.services.ts
// Business rules & validation for "$kebab". May call repo functions and
// external clients. Must never import the ORM directly or any framework API
// (cookies, headers, etc.).

import { find${Pascal}ById, create$Pascal } from "./$kebab.repo"
import type { $Pascal } from "./$kebab.domain"
import { ${Pascal}NotFoundError } from "./$kebab.domain"

export async function get$Pascal(id: number): Promise<$Pascal> {
  const $camel = await find${Pascal}ById(id) // repo call for a business decision
  if (!$camel) throw new ${Pascal}NotFoundError()
  return $camel
}

export async function create${Pascal}WithValidation(
  data: Omit<$Pascal, "id">
): Promise<$Pascal> {
  // TODO: apply business rules / invariants here before persisting
  return create$Pascal(data)
}
'''

CONTROLLERS_TS = '''// $kebab.controllers.ts
// Orchestrates requests: parses input, calls services, handles HTTP/session/
// cookies/redirects. No business rules and NEVER a direct repo import --
// always go through $kebab.services.ts, even for simple reads.
//
// The functions below are side-effect-free (no cookies/redirects), so they
// are safe to re-export from index.ts for cross-feature use. If you add a
// handler that calls cookies()/redirect(), keep it feature-private and
// expose a side-effect-free variant instead (see the architecture doc's
// "HTTP-Bound vs. Exportable Functions" section).

import { create${Pascal}Schema } from "./lib/$kebab.validations"
import { get$Pascal, create${Pascal}WithValidation } from "./$kebab.services"

export async function get${Pascal}Action(id: number) {
  const $camel = await get$Pascal(id) // service call, no HTTP side effects
  return $camel
}

export async function create${Pascal}Action(formData: unknown) {
  const dto = create${Pascal}Schema.parse(formData) // input shape validation only
  const $camel = await create${Pascal}WithValidation(dto) // service call
  // TODO: if this needs HTTP side effects (cookies, redirect, revalidation),
  // add a SEPARATE handler for routes (e.g. create${Pascal}Route) and keep
  // this one side-effect-free for cross-feature/index.ts use.
  return $camel
}
'''

VALIDATIONS_TS = '''// lib/$kebab.validations.ts
// Schema definitions for the "$kebab" feature.
// Use a createXSchema(t) factory if the app is internationalized;
// otherwise export the schema object directly.

import { z } from "zod"

export const create${Pascal}Schema = z.object({
  // TODO: define input shape
})

// Internationalized variant, if needed:
// export const create${Pascal}Schema = (t: (key: string) => string) =>
//   z.object({
//     // TODO: define input shape with translated error messages
//   })
'''

INDEX_TS = '''// index.ts -- public API for the "$kebab" feature.
// Only SIDE-EFFECT-FREE controller functions and public domain types are
// exported here (no cookies/headers/redirects -- those stay feature-private).
// Never export $kebab.services.ts or $kebab.repo.ts across feature boundaries.

export { get${Pascal}Action, create${Pascal}Action } from "./$kebab.controllers"
export type { $Pascal } from "./$kebab.domain"
'''

CLIENT_SHARED_TS = '''// src/lib/$client_kebab.client.ts
// SHARED external-service client for "$client_kebab" -- used by 2+ features.
// Wraps the raw third-party SDK. Third-party I/O only, no business logic.
// Services and controllers in any feature may import this directly.

export async function call$ClientPascal(/* TODO: params */): Promise<void> {
  // TODO: implement the third-party call
  throw new Error("call${ClientPascal} not implemented")
}
'''

CLIENT_LOCAL_TS = '''// lib/$client_kebab.client.ts
// FEATURE-LOCAL wrapper over the shared $client_kebab client, with this
// feature's own defaults/config. Third-party I/O only, no business logic.
// Only create this if the feature needs its own config -- otherwise import
// the shared client from src/lib/$client_kebab.client.ts directly.

// import { call$ClientPascal as callShared$ClientPascal } from "@/lib/$client_kebab.client"

export async function call$ClientPascal(/* TODO: params */): Promise<void> {
  // TODO: call the shared client with this feature's specific config
  throw new Error("call${ClientPascal} not implemented")
}
'''


def render(template_str: str, **kwargs) -> str:
    return Template(template_str).substitute(**kwargs)


def write_file(path: Path, content: str, force: bool) -> str:
    if path.exists() and not force:
        return f"SKIPPED (already exists): {path}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return f"CREATED: {path}"


def main():
    parser = argparse.ArgumentParser(description="Scaffold a Pragmatic Layered Architecture feature")
    parser.add_argument("--feature", required=True, help="Feature/domain name, e.g. 'order' or 'order-item'")
    parser.add_argument("--path", required=True, help="Base features path, e.g. 'src/features'")
    parser.add_argument("--client", default=None, help="Optional external client name to scaffold, e.g. 'mailer'")
    parser.add_argument(
        "--client-scope", choices=["local", "shared"], default="local",
        help="Where to put --client: 'local' (feature's lib/, default) or 'shared' (src/lib/, for use by 2+ features)",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args()

    kebab = to_kebab_case(args.feature)
    pascal = to_pascal_case(args.feature)
    camel = to_camel_case(args.feature)

    feature_dir = Path(args.path) / kebab
    results = []

    ctx = {"kebab": kebab, "Pascal": pascal, "camel": camel}

    results.append(write_file(
        feature_dir / f"{kebab}.domain.ts", render(DOMAIN_TS, **ctx), args.force,
    ))
    results.append(write_file(
        feature_dir / f"{kebab}.repo.ts", render(REPO_TS, **ctx), args.force,
    ))
    results.append(write_file(
        feature_dir / f"{kebab}.services.ts", render(SERVICES_TS, **ctx), args.force,
    ))
    results.append(write_file(
        feature_dir / f"{kebab}.controllers.ts", render(CONTROLLERS_TS, **ctx), args.force,
    ))
    results.append(write_file(
        feature_dir / "lib" / f"{kebab}.validations.ts", render(VALIDATIONS_TS, **ctx), args.force,
    ))
    results.append(write_file(
        feature_dir / "index.ts", render(INDEX_TS, **ctx), args.force,
    ))

    if args.client:
        client_kebab = to_kebab_case(args.client)
        client_pascal = to_pascal_case(args.client)
        client_ctx = {"client_kebab": client_kebab, "ClientPascal": client_pascal}

        if args.client_scope == "shared":
            # src/lib/ sits alongside (not inside) the features base path.
            # If --path is e.g. src/features, shared lib is src/lib.
            shared_lib_dir = Path(args.path).parent / "lib"
            results.append(write_file(
                shared_lib_dir / f"{client_kebab}.client.ts",
                render(CLIENT_SHARED_TS, **client_ctx), args.force,
            ))
        else:
            results.append(write_file(
                feature_dir / "lib" / f"{client_kebab}.client.ts",
                render(CLIENT_LOCAL_TS, **client_ctx), args.force,
            ))

    print(f"\nScaffolded '{kebab}' feature at {feature_dir}/\n")
    for r in results:
        print(f"  {r}")
    print()


if __name__ == "__main__":
    sys.exit(main())