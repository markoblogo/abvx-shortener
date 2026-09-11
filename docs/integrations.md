# Integrations

## Git Tweet

[Git Tweet](https://github.com/markoblogo/git-tweet) can use ABVX Shortener as an optional companion before publishing release links.

Recommended boundary:

1. Git Tweet prepares and approves the canonical release URL.
2. It calls `POST /api/shorten` with a dedicated `writer` key.
3. It publishes the returned `shortUrl` to X or Bluesky.
4. A shortener failure leaves the canonical URL intact; it must not block the post.

Use a separate key ID such as `git-tweet` and restrict `ALLOW_URL_DOMAINS` when the deployment serves only known publishing domains. Keep the API secret in Git Tweet's server environment; never expose it to client-side code.

## Other automation

Any server-side workflow can use the same API. Prefer one writer key per integration so audit events preserve actor identity and keys can be rotated independently.
