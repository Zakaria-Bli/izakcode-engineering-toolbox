#!/usr/bin/env sh
set -e

branch_name=$(git branch --show-current)

pattern="^(feat|fix|style|refactor|chore|test|build|ci|infra|docs|perf)/[a-z0-9]+(-[a-z0-9]+)*$"

if ! echo "$branch_name" | grep -Eq "$pattern"; then
  echo "❌ Invalid branch name: $branch_name"
  echo "👉 Expected format: type/scope-description"
  echo "👉 Allowed types: feat, fix, style, refactor, chore, test, build, ci, infra, docs, perf"
  echo "👉 Example: feat/seo-setup, fix/auth-contract, style/theme-update, chore/code-quality-setup, docs/readme-refresh, perf/image-cache"
  echo "👉 To commit on main, master, or staging, use --no-verify intentionally"
  exit 1
fi
