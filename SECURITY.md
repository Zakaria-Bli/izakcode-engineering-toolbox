# Security Policy

## Supported versions

This repository is evolving and does not currently publish versioned packages.
Security fixes apply to the current `main` branch unless a future release process is documented.

## Reporting a vulnerability

If you find a vulnerability in a module, template, playground, or tooling setup, report it privately when possible.

Include:

- affected area or file path
- reproduction steps
- expected impact
- suggested fix if known

Do not include real secrets, credentials, tokens, or private environment values in reports.

## Secrets

Never commit secrets or real `.env` files.
Use `.env.example` files for documentation only.

See:

```txt
docs/principles/environment.md
```
