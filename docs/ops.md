# Operations

## Safe deployment

1. Export or back up the `LINKS` namespace.
2. Run `npm ci`, `npm run check`, `npm audit --audit-level=high`, and `npx wrangler deploy --dry-run`.
3. Run `npm run migrate-kv:dry` when upgrading legacy string records.
4. Test the generated bundle locally with `npx wrangler dev`.
5. Deploy with `npm run deploy` or the manual **Deploy production** workflow.
6. Verify `/health`, create a disposable link, follow it, inspect it, then disable it.

The GitHub deployment workflow needs repository secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Restrict the token to this Worker and its KV namespace.

## Smoke checks

```bash
curl --fail https://go.example.com/health
ABVX_ENDPOINT=https://go.example.com ABVX_API_KEY=... ./bin/abvx-shorten shorten https://example.com/smoke --custom-slug smoke-test
curl --head https://go.example.com/smoke-test
```

Role-based clients must also set `ABVX_API_KEY_ID`.

## Monitoring

- Cloudflare Workers Logs are enabled in `wrangler.toml`.
- `/api/stats` reports approximate first-party KV counters.
- `/api/events` exposes expiring management events.
- HTTP responses carry a `requestId`; correlate it with `cf-ray` where available.

KV counters are not atomic. Do not use them for billing or security quotas. The native `RATE_LIMITER` binding protects creation requests independently.

## Backup and restore

Use `GET /api/links/export?format=json` with an admin key for a portable, paginated application-level export. For disaster recovery, also export the Cloudflare KV namespace before migrations or bulk deletion.

Treat exports as sensitive: they include destination URLs, ownership metadata and private-link flags.

## Upgrades

1. Read `CHANGELOG.md` and compare `worker/wrangler.toml` bindings.
2. Run `npm ci` so the lockfile controls tool versions.
3. Regenerate bindings with `npm run types`.
4. Run the KV migration dry run and canary when coming from v0.1.
5. Deploy, verify, then create the Git tag.

## Rollback

Use Cloudflare's deployment rollback for Worker code. Do not roll back a KV migration by deploying old code alone. Restore the namespace from a pre-migration export or follow [migration.md](migration.md).

## Common failures

| Symptom | Check |
|---|---|
| `401 Invalid API key` | Secret value and `X-API-Key-Id`; malformed `API_KEYS_JSON` fails closed |
| `403 Origin is not allowed` | `ALLOW_NO_ORIGIN`, same-origin host, and `ALLOWED_ORIGINS` |
| `403 Writers can only…` | Use the creating writer key or an admin key |
| `429 Rate limit exceeded` | Native binding limit and key identity |
| Redirect returns `404` | Link expiry, disabled state, slug spelling, and KV namespace binding |
| Local and production differ | Confirm both use the expected config and KV namespace |
