#!/usr/bin/env python3
"""Check that next-intl JSON message files have identical nested keys.

Usage:
  python scripts/check_message_keys.py src/lib/i18n/messages
  python scripts/check_message_keys.py src/lib/i18n/messages --base en.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def flatten_keys(value: Any, prefix: str = "") -> set[str]:
    if isinstance(value, dict):
        keys: set[str] = set()
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            keys.update(flatten_keys(child, path))
        return keys

    return {prefix}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("messages_dir", type=Path, help="Directory containing locale JSON files")
    parser.add_argument("--base", help="Base JSON file name, e.g. en.json. Defaults to first sorted file.")
    args = parser.parse_args()

    messages_dir = args.messages_dir
    if not messages_dir.is_dir():
        print(f"ERROR: messages directory not found: {messages_dir}", file=sys.stderr)
        return 2

    files = sorted(path for path in messages_dir.glob("*.json") if path.is_file())
    if len(files) < 2:
        print("ERROR: expected at least two locale JSON files", file=sys.stderr)
        return 2

    by_name = {path.name: path for path in files}
    base_path = by_name.get(args.base) if args.base else files[0]
    if base_path is None:
        print(f"ERROR: base file not found: {args.base}", file=sys.stderr)
        return 2

    try:
        base_keys = flatten_keys(load_json(base_path))
    except Exception as exc:  # noqa: BLE001 - CLI should report JSON/path errors clearly
        print(f"ERROR: failed to read {base_path}: {exc}", file=sys.stderr)
        return 2

    failed = False
    for path in files:
        try:
            keys = flatten_keys(load_json(path))
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: failed to read {path}: {exc}", file=sys.stderr)
            failed = True
            continue

        missing = sorted(base_keys - keys)
        extra = sorted(keys - base_keys)

        if missing or extra:
            failed = True
            print(f"\n{path.name} differs from {base_path.name}:")
            if missing:
                print("  Missing keys:")
                for key in missing:
                    print(f"    - {key}")
            if extra:
                print("  Extra keys:")
                for key in extra:
                    print(f"    - {key}")

    if failed:
        print("\nMessage key parity check failed.")
        return 1

    print(f"Message key parity check passed for {len(files)} files using {base_path.name} as base.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
