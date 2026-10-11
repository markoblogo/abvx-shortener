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
- `/api/stats` reports historical KV counters with `source=legacy-kv`, `collection=stopped`, `complete=false` and `currentTotals=null`; it is not live analytics.
- `/api/events` exposes expiring management events.
- HTTP responses carry a `requestId`; correlate it with `cf-ray` where available.

New metrics never use KV counters. Logs can be sampled or expire; do not equate log counts with exact human traffic. The native `RATE_LIMITER` binding protects creation requests independently.

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

## Passive operation and analytics

The Worker has no cron or scheduled handler. Leave the manual production workflow manual. Requests still use CPU/KV reads; being idle cannot stop unsolicited Internet traffic. Management writes and their audit events remain intentional. The local KV rate-limiter fallback is not a production quota mechanism; keep the native `RATE_LIMITER` binding.

For current metrics, filter Workers Logs on `event=metric` and group by `metric`. Destination URLs, credentials and private slugs are not included in metric logs. Runtime failures emit `request_error` with a request ID; clients receive a generic 500 response.

Optionally, after explicit production approval, add an Analytics Engine dataset binding (no binding is provisioned by this PR):

```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "abvx_shortener_metrics"
```

`blob1` is the metric, `blob2` is the slug for successful authorized GET redirects (empty otherwise), and `double1` is 1. Treat dataset access as sensitive because private slugs may be recorded. Query through the authenticated SQL API; do not add API tokens to public config:

```sql
SELECT blob1 AS metric, SUM(_sample_interval * double1) AS requests
FROM abvx_shortener_metrics
WHERE timestamp >= NOW() - INTERVAL '1' DAY
GROUP BY blob1
```

This weighting accounts for Analytics Engine sampling; counts remain estimates when sampled. HEAD is excluded from `redirect_hit`; expired/disabled fallback responses retain their own outcome metrics. The API does not query Analytics Engine, and missing current counts remain `null`. Historical KV stats are bounded to 90 aligned buckets (at most 900 counter reads, below the invocation budget).

Before approved rollout, record the current Worker version, export LINKS securely, compare allowed destinations with the new stored-URL validation, and verify the clients that consume `/api/stats`. Deploy only after approval. Code rollback is sufficient: no data migration or deletion is performed. Old code restores the problematic KV telemetry, so prefer a forward fix if possible.
