import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PUBLIC_EXPORTS = [
  ".",
  "./core",
  "./domain",
  "./ports",
  "./testing",
  "./adapters/s3",
  "./adapters/local",
  "./adapters/sharp",
  "./adapters/content-inspector",
  "./adapters/express",
  "./adapters/next",
] as const
const FORBIDDEN_CORE_IMPORT_PATTERNS = [
  /^sharp$/,
  /^@aws-sdk\//,
  /^express$/,
  /^next(?:\/|$)/,
  /^react(?:\/|$)/,
  /^drizzle-orm(?:\/|$)/,
  /adapters\//,
  /process\.env/,
] as const

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return await listTypeScriptFiles(entryPath)
      }

      return entry.name.endsWith(".ts") ? [entryPath] : []
    })
  )

  return files.flat()
}

function extractModuleSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)
  ).map((match) => match[1] ?? "")
}

describe("package boundary", () => {
  it("keeps core/domain/ports free of framework and heavy adapter imports", async () => {
    const files = [
      ...(await listTypeScriptFiles(path.join(PACKAGE_ROOT, "src", "core"))),
      ...(await listTypeScriptFiles(path.join(PACKAGE_ROOT, "src", "domain"))),
      ...(await listTypeScriptFiles(path.join(PACKAGE_ROOT, "src", "ports"))),
    ]
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, "utf8")
      const specifiers = extractModuleSpecifiers(source)
      const checkedValues = [...specifiers, source]

      for (const value of checkedValues) {
        for (const pattern of FORBIDDEN_CORE_IMPORT_PATTERNS) {
          if (pattern.test(value)) {
            violations.push(`${path.relative(PACKAGE_ROOT, file)} -> ${value}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("publishes only built dist entry points for public exports", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")
    ) as {
      exports: Record<string, string | { types?: string; import?: string }>
      files: string[]
      main: string
      private?: boolean
      types: string
    }

    expect(packageJson.private).toBe(false)
    expect(packageJson.main).toBe("./dist/index.js")
    expect(packageJson.types).toBe("./dist/index.d.ts")
    expect(packageJson.files).toContain("dist")

    for (const exportName of PUBLIC_EXPORTS) {
      const entry = packageJson.exports[exportName]
      expect(entry).toEqual({
        types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/),
        import: expect.stringMatching(/^\.\/dist\/.+\.js$/),
      })
    }
  })

  it("keeps heavy adapters as optional peer dependencies", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")
    ) as {
      peerDependencies: Record<string, string>
      peerDependenciesMeta: Record<string, { optional?: boolean }>
    }
    const optionalPeers = [
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-presigned-post",
      "@aws-sdk/s3-request-presigner",
      "sharp",
    ]

    for (const dependency of optionalPeers) {
      expect(packageJson.peerDependencies[dependency]).toBeDefined()
      expect(packageJson.peerDependenciesMeta[dependency]?.optional).toBe(true)
    }
  })
})
