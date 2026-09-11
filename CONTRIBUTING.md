# Contributing

Issues and focused pull requests are welcome.

## Development

```bash
git clone https://github.com/markoblogo/abvx-shortener.git
cd abvx-shortener/worker
npm ci
npm run check
```

Use `npx wrangler dev` for a local Worker. Put local secrets in `worker/.dev.vars`; never commit that file.

## Pull requests

- Add behavior-level coverage for API changes.
- Update `openapi.yaml` and the owning document when a public contract changes.
- Keep extension host permissions narrow.
- Run `npm run check` and `npx wrangler deploy --dry-run`.
- Describe migration or deployment effects explicitly.

Report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.
