# Configuration

Non-secret values live in `worker/wrangler.toml`. Secrets must be created with `wrangler secret put`.

## Bindings

| Binding | Required | Purpose |
|---|---:|---|
| `LINKS` | yes | Link records, audit events and approximate counters |
| `RATE_LIMITER` | production | Native per-key link-creation limiter |

Replace the repository's KV namespace ID with one from your Cloudflare account. Choose a positive, account-unique `namespace_id` for the rate limiter.

## Variables

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `https://go.abvx.xyz` | Public origin used in returned short URLs |
| `ALLOW_NO_ORIGIN` | `true` | Allow authenticated CLI/server requests without an Origin header |
| `ALLOWED_ORIGINS` | empty | Comma-separated additional web or `chrome-extension://` origins |
| `STRIP_TRAILING_SLASH` | `true` | Canonicalize destination paths |
| `MAX_URL_LENGTH` | `2048` | Maximum destination/fallback URL length |
| `DEFAULT_TTL_SECONDS` | `0` | Default link lifetime; zero means no expiry |
| `TRUST_MODE` | `personal` | `personal`, `readonly`, or `readonly-create` |
| `ALLOW_URL_DOMAINS` | empty | Optional comma-separated destination allowlist |
| `DENY_URL_DOMAINS` | empty | Optional comma-separated destination denylist |
| `URL_PRECHECK_URL` | empty | Optional external URL-policy endpoint |
| `URL_PRECHECK_TIMEOUT_MS` | `1500` | Precheck timeout |
| `URL_PRECHECK_FAIL_OPEN` | `false` | Continue when the precheck service fails |
| `DEFAULT_REDIRECT_TYPE` | `302` | Default `301` or `302` response |
| `STATS_RETENTION_DAYS` | `30` | Approximate KV counter and audit-event retention |

`RATE_LIMIT_WINDOW_SEC` and `RATE_LIMIT_MAX` configure the local KV fallback. Production limits come from the `RATE_LIMITER` binding.

## Secrets

### Single personal key

```bash
npx wrangler secret put API_KEY
```

### Role-based keys

`API_KEYS_JSON` replaces the personal key path when present. Store it as a secret:

```bash
npx wrangler secret put API_KEYS_JSON
```

Example value:

```json
[
  {"id":"admin-1","role":"admin","secret_hash":"sha256:HEX_DIGEST"},
  {"id":"publisher","role":"writer","secret_hash":"sha256:HEX_DIGEST"},
  {"id":"reports","role":"reader","secret_hash":"sha256:HEX_DIGEST"}
]
```

Clients send both `X-API-Key` and `X-API-Key-Id`. Invalid JSON, unknown roles, empty arrays and obsolete 32-bit hashes fail closed.

## Origin examples

```toml
ALLOW_NO_ORIGIN = "true"
ALLOWED_ORIGINS = "https://publisher.example,chrome-extension://abcdefghijklmnop"
```

The Worker's own origin is always allowed. With an empty extension-origin list, installed Chrome extensions remain compatible when they hold a valid API key. Add exact extension origins when you need stricter control.
