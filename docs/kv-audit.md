# KV and redirect audit — 2026-10-11

Audited repository baseline: `94d680d86ecf0bf05a683276a3f2520daf3c6954`.
Cloudflare production version: `ff07fba6-266b-4832-99fd-4fa42362a675`, deployed 2026-09-14. The downloaded production bundle contains the same metric and redirect write paths as the baseline. A health version string alone does not prove a Git SHA.

## Verified defects and evidence

- Every successful redirect performs one link read, one metric read and **two KV writes** (minute counter and full link rewrite). Misses also read/write a shared minute counter. Bots therefore consume writes even without using valid short links.
- Cloudflare Logs on 2026-10-11 at 10:27:30.390 Europe/Paris show `GET /v1/.env` → `KV PUT failed: 429 Too Many Requests`, stack `incrementMetric → handleRedirect → finish`, production version above. The same error appears for scans of `/src/.env`, workflow files and other non-link paths. Overview reported 103 failed invocations in its trailing 24-hour window; Logs showed 176 error events in a separately evaluated 24-hour window. These are different measures and were not reconciled request by request.
- KV usage at inspection: October 11 reads 278, writes 151, deletes 0, lists 0, storage 253 kB. These totals do not attribute every write or explain the previous day's warning by themselves.
- KV counters lose concurrent updates and hit the [one write per second per key limit](https://developers.cloudflare.com/kv/api/write-key-value-pairs/). Saving stale link snapshots after redirects can overwrite concurrent edits or restore disabled records.
- Disabled-link fallback was unreachable because the lookup filtered disabled records. Expired links were deleted on reads. Stored targets/fallbacks bypassed current URL validation; IPv6 brackets bypassed private-host checks, while legitimate domains starting with `fc`/`fd` were incorrectly rejected.
- Returning an asynchronous handler promise without awaiting it bypassed the outer error handler. Historical stats allowed 500 × 10 reads, beyond a single invocation's [KV operations budget](https://developers.cloudflare.com/kv/platform/limits/).

## Prepared change; approval required before rollout

Redirects perform zero KV writes/deletes. Only authenticated management writes link data and expiring audit events. Invalid paths are rejected before KV reads. Stored redirects are validated, private access precedes fallbacks, and responses use no-store. Async failures return controlled 500 responses with request-correlated server diagnostics.

Metrics use structured Logs, plus optional Analytics Engine with independent events. A successful authorized GET counts one redirect request, including bot traffic; HEAD does not count as a click. Validation rejections and management lookups use separate metrics. Legacy counters remain available with explicit incomplete/stopped metadata, bounded to 90 buckets; current counts are unavailable through that legacy API. See [ops.md](ops.md) for sampling and rollout details.

No cron, scheduled handler, migration, namespace cleanup, domain edit or production deployment is included. The related Git Tweet application requires its own passive-operation change because it has hourly Actions polling, a configured daily Vercel cron and automatic webhook ingestion. Its two Railway PostgreSQL services are not two shortener deployments; do not remove either until consumers and backups are identified.
