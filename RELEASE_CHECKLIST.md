# ABVX Shortener release checklist

Use this checklist for v0.3.0 and later releases. A passing local build does not prove that CI, production, or the public release succeeded; record each state separately.

## Prepare

- [ ] Version matches in `worker/package.json`, `worker/package-lock.json`, and `extension/manifest.json`.
- [ ] `CHANGELOG.md` describes user-visible and security changes.
- [ ] Cloudflare secrets contain `API_KEY` or a valid `API_KEYS_JSON`; optional Git Tweet automation uses an isolated `GIT_TWEET_API_KEY`; role-based hashes use `sha256:<hex>`.
- [ ] `BASE_URL`, `ALLOWED_ORIGINS`, trust policy, redirect type, and KV/rate-limit bindings match production.
- [ ] Export existing KV data before a migration or other bulk write.

## Verify locally

```bash
cd worker
npm ci
npm run check
npm audit --audit-level=high
npx wrangler deploy --dry-run --outdir ../dist
```

- [ ] Worker unit, security, and local Cloudflare runtime tests pass.
- [ ] Type checking, lint, repository links, and extension validation pass.
- [ ] Dependency audit reports no high or critical vulnerabilities.
- [ ] Deployment bundle builds successfully.
- [ ] Web UI works at desktop and mobile widths without console errors.

## Migrate and deploy

- [ ] If legacy string records remain, run `npm run migrate-kv:dry` and review its summary.
- [ ] Run a controlled canary before a full migration; follow `docs/migration.md`.
- [ ] Deploy through the production workflow or `npm run deploy`.
- [ ] Verify `/health` reports the intended version.
- [ ] Create a disposable link, follow its redirect, read it through the management API, then delete it.
- [ ] Confirm invalid credentials, an unlisted browser origin, and a disallowed URL are rejected.
- [ ] Check Cloudflare logs and error rate after deployment.

## Publish

- [ ] Merge only after required CI checks pass.
- [ ] Tag the exact deployed commit as `vX.Y.Z` and push the tag.
- [ ] Confirm the release workflow publishes the CLI and extension archives.
- [ ] Test the downloaded extension archive and CLI asset.
- [ ] Confirm the GitHub release page, README links, live service, and release badge are public.
