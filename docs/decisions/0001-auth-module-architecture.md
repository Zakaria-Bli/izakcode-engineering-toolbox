# 0001. Auth Module Architecture

Date: 2026-07-22

## Status

Accepted

## Context

The toolbox needs a reusable authentication module derived from three existing implementations:

- Hotel Reservation and Operations Platform auth: Express-style controllers, admin-only accounts, Argon2 passwords, hashed sessions, request-origin checks.
- E-commerce Platform auth: Next.js Server Actions, multi-role users, email verification, password reset, React context/hooks/forms.
- Real Estate Marketplace auth: Next.js Server Actions, multi-role users, email verification, password reset, React context/hooks/forms.

These domain implementations prove a shared authentication model, but each is coupled to its application framework, persistence model, roles, permissions, environment variables, and UI.

## Decision

Build `modules/auth` as a framework-agnostic authentication core with adapters and recipes.

The core module must not import Express, Next.js, React, Drizzle, env loaders, UI packages, or application-specific roles and permissions.

Core auth behavior depends on injected ports and policies:

- repositories for users, credentials, sessions, and auth tokens
- password hashing and verification
- secure token generation and hashing
- clock access
- optional mailer and logger
- policies for user IDs, roles, permissions, and account status

Implementation lives under `modules/auth/src`. Framework integrations belong in `src/adapters`. Database schemas and app-specific examples belong in recipes. UI belongs in templates or app code.

## Consequences

Benefits:

- Auth logic can be reused across Express APIs, Next.js apps, and future runtimes.
- Application-specific user shape, roles, permissions, and account status rules stay configurable.
- Security-sensitive behavior, such as hashed tokens, one-time token consumption, session expiry, and fail-closed repository requirements, is centralized.
- Existing app implementations can migrate incrementally through adapters.

Tradeoffs:

- The initial design requires more interfaces and tests than a copied feature folder.
- Adapters must map app/framework details into core contracts.
- Some convenience code, especially React UI, cannot live in the core module.

## Alternatives considered

- Copy one existing implementation into the toolbox: rejected because it would preserve framework and application coupling.
- Build separate Express and Next auth modules: rejected because the shared domain would drift.
- Use a third-party auth framework directly: rejected because the toolbox goal is to capture reusable internal architecture and copy-and-adapt patterns.
