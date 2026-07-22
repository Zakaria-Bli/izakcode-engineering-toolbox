const conventionalTypes = [
  "feat",
  "fix",
  "style",
  "refactor",
  "chore",
  "test",
  "build",
  "ci",
  "infra",
  "docs",
  "perf",
  "revert",
]

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-empty": [2, "never"],
    "type-enum": [2, "always", conventionalTypes],
  },
}
