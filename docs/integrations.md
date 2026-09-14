# Integrations

## Git Tweet

[Git Tweet](https://github.com/markoblogo/git-tweet) can use ABVX Shortener as an optional companion before publishing release links.

Recommended boundary:

1. Git Tweet prepares and approves the canonical release URL.
2. It calls `POST /api/shorten` with a dedicated `writer` key.
3. It publishes the returned `shortUrl` to X or Bluesky.
4. A shortener failure leaves the canonical URL intact; it must not block the post.

Store a dedicated `GIT_TWEET_API_KEY` Worker secret and configure the same value as `SHORTENER_API_KEY` in Git Tweet. Set `SHORTENER_API_KEY_ID=git-tweet`; Git Tweet sends both `X-API-Key` and `X-API-Key-Id`. This preserves the existing personal Shortener key and gives release automation writer-only authority. Keep the API secret in server environments only.

## Other automation

Any server-side workflow can use the same API. Prefer one writer key per integration so audit events preserve actor identity and keys can be rotated independently.
