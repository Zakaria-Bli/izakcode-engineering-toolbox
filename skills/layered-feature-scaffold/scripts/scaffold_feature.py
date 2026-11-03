#!/usr/bin/env python3
"""
Scaffold a new feature folder following the Pragmatic Layered Architecture:
controllers / services / repo / domain / validations / index.ts, plus the
shared transaction and persistence-error helpers (created once per project).

Usage:
    python scaffold_feature.py --feature order --path src/features
    python scaffold_feature.py --feature order --path src/features --lib-import @/lib
    python scaffold_feature.py --feature order --path src/features --gateway mailer
    python scaffold_feature.py --feature order --path src/features --force
"""

import argparse
import os
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


def lib_specifier(from_dir: Path, lib_dir: Path, lib_import: str | None) -> str:
    """Import prefix for the shared lib dir as seen from from_dir: the alias if given, else a relative path."""
    if lib_import:
        return lib_import.rstrip("/")
    rel = Path(os.path.relpath(lib_dir, from_dir)).as_posix()
    return rel if rel.startswith(".") else f"./{rel}"


# Templates use $Placeholder substitution (string.Template), not str.format(),
# since the generated TypeScript is full of literal { } braces that would
# collide with .format()'s escaping rules.

TRANSACTION_REPO_TS = '''// transaction.repo.ts
// Shared transaction boundary. It is a .repo.ts file because it touches the
// ORM; feature repos re-export withTransaction, and services only ever see
// the opaque Tx type, so ORM types never leak past the repo layer.

// import { db } from "@/db" // TODO: wire up your ORM client

declare const txBrand: unique symbol

/** Opaque transaction handle: services can pass it along but not use it. */
export type Tx = { readonly [txBrand]: true }

/**
 * Runs fn inside one transaction. Pass the caller's tx as `outer` to join it
 * instead of nesting -- the outermost caller owns commit/rollback. Throwing
 * inside fn rolls everything back, so don't swallow errors inside it.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, outer?: Tx): Promise<T> {
  if (outer) return fn(outer)
  // TODO: return db.transaction((ormTx) => fn(ormTx as unknown as Tx))
  throw new Error("withTransaction not implemented")
}

// Repo-only helper: turn the opaque handle back into the ORM executor.
// export function executor(tx?: Tx) {
//   return (tx as unknown as typeof db | undefined) ?? db
// }
'''

PERSISTENCE_ERRORS_CORE_TS = '''// persistence-errors.core.ts
// Neutral persistence errors. Repos translate ORM/driver errors into these so
// raw ORM errors never escape the repo layer; services map them to domain
// errors (e.g. UniqueViolationError on users_email_key -> EmailTakenError).

export class PersistenceError extends Error {
  constructor(message: string, readonly constraint?: string) {
    super(message)
    this.name = "PersistenceError"
  }
}

/** A unique constraint rejected the write (duplicate key). */
export class UniqueViolationError extends PersistenceError {
  constructor(constraint?: string) {
    super("Unique constraint violated", constraint)
    this.name = "UniqueViolationError"
  }
}

/** A foreign key constraint rejected the write (missing or still-referenced row). */
export class ForeignKeyViolationError extends PersistenceError {
  constructor(constraint?: string) {
    super("Foreign key constraint violated", constraint)
    this.name = "ForeignKeyViolationError"
  }
}

/** Optimistic-lock mismatch or serialization failure; the use case may be retried. */
export class ConcurrentUpdateError extends PersistenceError {
  constructor() {
    super("Concurrent update detected")
    this.name = "ConcurrentUpdateError"
  }
}
'''

DOMAIN_TS = '''// $kebab.domain.ts
// Domain types, domain errors, and value objects for the "$kebab" feature.
// Invariants a single type enforces on itself belong here; rules that need
// repo/gateway data belong in $kebab.services.ts. No ORM or framework types.

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
// The only feature file that touches the ORM for "$kebab". Maps DB rows to
// domain types and translates driver errors into the neutral errors from
// persistence-errors.core.ts. No business rules, no domain errors.

import type { Tx } from "$lib/transaction.repo"
import type { $Pascal } from "./$kebab.domain"

// import { db } from "@/db" // TODO: wire up your ORM
// import { ${camel}Table } from "@/db/schema"
// import { UniqueViolationError } from "$lib/persistence-errors.core"

export { type Tx, withTransaction } from "$lib/transaction.repo"

export async function find${Pascal}ById(id: number, tx?: Tx): Promise<$Pascal | null> {
  // TODO: replace with a real query run on executor(tx)
  // const row = await executor(tx).query.${camel}Table.findFirst({ where: eq(${camel}Table.id, id) })
  // return row ? mapRowTo$Pascal(row) : null
  throw new Error("find${Pascal}ById not implemented")
}

export async function insert$Pascal(data: Omit<$Pascal, "id">, tx?: Tx): Promise<$Pascal> {
  // TODO: replace with a real insert, translating driver errors:
  // try { ... } catch (error) {
  //   if (isUniqueViolation(error)) throw new UniqueViolationError(error.constraint)
  //   throw error
  // }
  throw new Error("insert$Pascal not implemented")
}

// function mapRowTo$Pascal(row: typeof ${camel}Table.$$inferSelect): $Pascal {
//   // TODO: map ORM row -> domain type
// }
'''

SERVICES_TS = '''// $kebab.services.ts
// Use cases for "$kebab": workflow rules, authorization decisions, and
// business effects (persistence via the repo, third-party I/O via gateways).
// No ORM, no framework/transport APIs (cookies, headers, redirects), no
// .server.ts imports. Use cases re-exported from index.ts are the feature's
// public API, so keep them transport-independent.

import { type $Pascal, ${Pascal}NotFoundError } from "./$kebab.domain"
import { find${Pascal}ById, insert$Pascal, type Tx, withTransaction } from "./$kebab.repo"

export async function get$Pascal(id: number, tx?: Tx): Promise<$Pascal> {
  const $camel = await find${Pascal}ById(id, tx)
  if (!$camel) throw new ${Pascal}NotFoundError()
  return $camel
}

// Takes an optional tx so another feature's use case can run this inside its
// own transaction; without one, it opens its own.
export async function create$Pascal(data: Omit<$Pascal, "id">, tx?: Tx): Promise<$Pascal> {
  return withTransaction(async (activeTx) => {
    // TODO: workflow rules / authorization before persisting
    // TODO: map persistence errors to domain errors, e.g.
    //   UniqueViolationError -> ${Pascal}AlreadyExistsError
    return insert$Pascal(data, activeTx)
  }, tx)
}
'''

CONTROLLERS_TS = '''// $kebab.controllers.ts
// Transport adapter for "$kebab": parse input, resolve the current user from
// the session and pass it to use cases explicitly, call services, map domain
// errors to responses, and own transport effects (cookies, headers,
// redirects, cache revalidation). Imported only by the routing layer (app/
// pages, route handlers, server actions; Express routers) -- other features
// use index.ts instead. Never imports a repo, not even for a simple read.
//
// Next.js: adding "use server" here turns every export into a public
// endpoint, so each one must authenticate and authorize on its own.

import { create${Pascal}Schema } from "./lib/$kebab.validations"
import { create$Pascal, get$Pascal } from "./$kebab.services"

export async function get${Pascal}Action(id: number) {
  // TODO: map domain errors to responses (${Pascal}NotFoundError -> 404)
  return get$Pascal(id)
}

export async function create${Pascal}Action(formData: unknown) {
  const dto = create${Pascal}Schema.parse(formData) // input shape only
  const $camel = await create$Pascal(dto) // business effects happen in the use case
  // TODO: transport effects go here (redirect, revalidatePath, set-cookie)
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

INDEX_TS = '''// index.ts -- public API of the "$kebab" feature, importable by other features.
// Exports transport-independent use cases plus public domain types, errors,
// and value objects. Never export the repo (callers would bypass the use
// cases) or the controllers (importing them would drag framework code into
// the caller); the routing layer imports $kebab.controllers.ts directly.

export type { $Pascal } from "./$kebab.domain"
export { ${Pascal}ForbiddenError, ${Pascal}NotFoundError } from "./$kebab.domain"
export { create$Pascal, get$Pascal } from "./$kebab.services"
'''

GATEWAY_SHARED_TS = '''// $gateway_kebab.gateway.ts
// SHARED gateway for "$gateway_kebab" -- used by 2+ features. Wraps the raw
// third-party SDK: the call and response mapping only, no business logic.
// Services in any feature may import it; whether a failure fails the use
// case or gets retried is the calling service's decision.

export async function call$GatewayPascal(/* TODO: params */): Promise<void> {
  // TODO: implement the third-party call
  throw new Error("call${GatewayPascal} not implemented")
}
'''

GATEWAY_LOCAL_TS = '''// lib/$gateway_kebab.gateway.ts
// FEATURE-LOCAL wrapper over the shared $gateway_kebab gateway, with this
// feature's own defaults/config. Third-party I/O only, no business logic.
// Only keep this file if the feature needs its own config -- otherwise import
// the shared gateway directly.

// import { call$GatewayPascal as callShared$GatewayPascal } from "$lib/$gateway_kebab.gateway"

export async function call$GatewayPascal(/* TODO: params */): Promise<void> {
  // TODO: call the shared gateway with this feature's specific config
  throw new Error("call${GatewayPascal} not implemented")
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
    parser.add_argument(
        "--lib-path", default=None,
        help="Shared lib dir for transaction/persistence helpers and shared gateways "
             "(default: 'lib' next to --path, e.g. src/lib for src/features)",
    )
    parser.add_argument(
        "--lib-import", default=None,
        help="Import specifier for the shared lib dir, e.g. '@/lib' (default: a relative path)",
    )
    parser.add_argument(
        "--no-shared", action="store_true",
        help="Skip transaction.repo.ts / persistence-errors.core.ts (the project already has equivalents)",
    )
    parser.add_argument(
        "--gateway", "--client", dest="gateway", default=None,
        help="Optional third-party gateway to scaffold, e.g. 'mailer' (--client is a deprecated alias)",
    )
    parser.add_argument(
        "--gateway-scope", "--client-scope", dest="gateway_scope", choices=["local", "shared"], default="local",
        help="Where to put --gateway: 'local' (feature's lib/, default) or 'shared' (lib dir, for 2+ features)",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args()

    kebab = to_kebab_case(args.feature)
    pascal = to_pascal_case(args.feature)
    camel = to_camel_case(args.feature)

    feature_dir = Path(args.path) / kebab
    lib_dir = Path(args.lib_path) if args.lib_path else Path(args.path).parent / "lib"
    results = []

    ctx = {
        "kebab": kebab,
        "Pascal": pascal,
        "camel": camel,
        "lib": lib_specifier(feature_dir, lib_dir, args.lib_import),
    }

    if not args.no_shared:
        results.append(write_file(lib_dir / "transaction.repo.ts", TRANSACTION_REPO_TS, args.force))
        results.append(write_file(lib_dir / "persistence-errors.core.ts", PERSISTENCE_ERRORS_CORE_TS, args.force))

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

    if args.gateway:
        gateway_kebab = to_kebab_case(args.gateway)
        gateway_ctx = {
            "gateway_kebab": gateway_kebab,
            "GatewayPascal": to_pascal_case(args.gateway),
            "lib": lib_specifier(feature_dir / "lib", lib_dir, args.lib_import),
        }

        if args.gateway_scope == "shared":
            results.append(write_file(
                lib_dir / f"{gateway_kebab}.gateway.ts",
                render(GATEWAY_SHARED_TS, **gateway_ctx), args.force,
            ))
        else:
            results.append(write_file(
                feature_dir / "lib" / f"{gateway_kebab}.gateway.ts",
                render(GATEWAY_LOCAL_TS, **gateway_ctx), args.force,
            ))

    print(f"\nScaffolded '{kebab}' feature at {feature_dir}/\n")
    for r in results:
        print(f"  {r}")
    print()


if __name__ == "__main__":
    sys.exit(main())
