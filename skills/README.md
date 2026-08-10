# Skills

Reusable agent skills, rules, and scaffolding workflows.

Keep each skill self-contained when possible:

```txt
skills/<skill-name>/
  SKILL.md
  references/
  scripts/
```

Use `references/` for long-form rules and rationale loaded by the skill. Use skill-local `scripts/` for automation that belongs to that skill. Root `scripts/` remains reserved for repository maintenance.
