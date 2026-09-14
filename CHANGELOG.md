# Changelog

## v0.4.0 — 2026-09-14

- Added an isolated `GIT_TWEET_API_KEY` writer identity without rotating the personal Shortener key.
- Documented the production Git Tweet header and environment contract.
- Kept canonical release URLs as the fallback when shortening is unavailable.

## v0.3.1 — 2026-09-11

- Fixed `abvx-shorten --help` to exit successfully.
- Added the CLI smoke check to the shared local and CI quality gate.
- Updated GitHub workflow actions to their Node 24 based releases.

## v0.3.0 — 2026-09-11

- Restored the browser shortening form and refreshed the public product page without external UI dependencies.
- Hardened API authentication and authorization:
  - SHA-256 role-key hashes replace the obsolete 32-bit format;
  - malformed `API_KEYS_JSON` fails closed;
  - writer keys can modify only their own links;
  - token-bound private links are limited to their creator and admins;
  - same-origin/CORS and authenticated non-browser behavior are explicit.
- Added native Cloudflare rate limiting, generated Worker binding types, Workers Logs and non-blocking redirect bookkeeping.
- Updated to Wrangler 4 and Cloudflare's Vitest runtime integration.
- Added extension permission minimization, role-key IDs and safe DOM rendering.
- Added OpenAPI, English/Russian onboarding, architecture, configuration, security, operations and integration docs.
- Added dependency automation, release assets and a gated production deployment workflow.

- Added operational APIs:
  - `GET /api/stats`
  - `GET /api/links`
  - `POST /api/links/bulk`
  - `GET /api/links/export`
  - `GET /api/events`
- Added private link support in redirect flow:
  - `private`, `privateTokenRequired`, `redirectType`, `fallbackUrl`
- Added trust model:
  - `TRUST_MODE=personal|readonly|readonly-create`
  - `API_KEYS_JSON` role support (`admin`/`writer`/`reader`)
- Extended allow/deny policy and optional URL precheck hook.
- Added URL-level observability and lightweight KV audit trail:
  - redirect + API + conflict metrics
  - immutable `events` records
- Added extension operational UX:
  - command palette and shortcuts (`Ctrl+Shift+S`, `Alt+Shift+S`)
  - context menu and omnibox (`abvx`)
  - history quick actions in popup and "open last"
- Added production-safe KV migration tooling:
  - `migrate-kv:dry` and `migrate-kv:canary` npm scripts
  - JSON structured logs and migration incident checklist
- Added CLI entrypoint `bin/abvx-shorten` and `docs/v0.3.md`, `docs/ops.md`

## v0.2.0

- Added secure-by-default API defaults and configurable API allowlisting
- Added `POST /api/shorten`, `GET/PUT/DELETE /api/link/:slug`
- Added URL canonicalization + expanded validation (`javascript:`, private/local host blocks, credentials)
- Added TTL / disabled soft-delete support in KV records
- Added custom slug support with reserved slug protection and conflict handling
- Added MV3 extension UX upgrade: configurable endpoint, preview, copy/open/retry, history
- Added project CI (`.github/workflows/ci.yml`) with lint/typecheck/test
- Added unit/integration tests and test matrix for core flows
- Added migration path notes for legacy v0.1 KV values
