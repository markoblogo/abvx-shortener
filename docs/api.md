# API reference

The canonical machine-readable contract is [openapi.yaml](../openapi.yaml). All management endpoints require `X-API-Key`; role-based keys also require `X-API-Key-Id`.

## Create or reuse a link

```http
POST /api/shorten
Content-Type: application/json
X-API-Key: …

{"url":"https://example.com/article","customSlug":"article","ttl":86400}
```

Optional fields: `overwrite`, `ttl`, `expiresAt`, `redirectType`, `fallbackUrl`, `private`, `privateTokenRequired`, and `visibility`.

## Redirect

`GET /:slug` returns the configured `301` or `302`. Disabled and expired links return `404` by default or redirect to a configured fallback. Send `Prefer: code=410` to request `410` for disabled/expired records.

A private link requires an API key header. When `privateTokenRequired=true`, only the creating key or an admin key can follow it.

## Manage links

```text
GET    /api/link/:slug
PUT    /api/link/:slug
DELETE /api/link/:slug
GET    /api/links?limit=50&cursor=...
POST   /api/links/bulk
GET    /api/links/export?format=json|csv
```

Writers can modify their own links. Bulk deletion and export require an admin key. `DELETE` performs a soft delete; add `?hard=true` for permanent removal.

## Operations

```text
GET /health
GET /api/stats?window=minute|hour|day
GET /api/events?cursor=...&type=create|update|delete|soft-delete|restore
```

Stats requests are limited to 500 buckets. Counters are approximate and intended for operational diagnosis.

## Errors

```json
{
  "code": "bad_request",
  "message": "URL domain is not allowed",
  "requestId": "…",
  "details": {}
}
```

Common status codes: `400`, `401`, `403`, `404`, `405`, `409`, `429`, and `500`.
