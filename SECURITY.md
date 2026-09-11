# Security Policy

Security fixes target the latest release and `main`.

## Report a vulnerability

Do not open a public issue. Use **Security → Report a vulnerability** in this repository. If private reporting is unavailable, email **abv-creative@proton.me**.

Include the affected endpoint or client, impact, reproduction steps and any suggested mitigation. Do not include production API keys, Cloudflare tokens, KV exports or personal link data.

## Deployment requirements

- Store `API_KEY` and `API_KEYS_JSON` with `wrangler secret put`.
- Use long, randomly generated API keys.
- Keep `URL_PRECHECK_FAIL_OPEN=false` when the precheck is a security boundary.
- Configure exact browser and extension origins when the deployment serves multiple users.
- Treat exported destinations and audit events as private operational data.

## Supported scope

Authentication or authorization bypasses, unsafe redirects, secret exposure, cross-origin request flaws, migration data loss and extension privilege problems are in scope.
