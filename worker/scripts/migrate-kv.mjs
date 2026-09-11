import process from "node:process";

const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CREATED_BY = process.env.MIGRATE_CREATED_BY;
const DEFAULT_TTL_SECONDS = Number(process.env.DEFAULT_TTL_SECONDS || "0");
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const MAX_KEYS = Number(process.env.MAX_KEYS || "0");
const MAX_PER_PAGE = Math.min(1000, Math.max(1, Number(process.env.LIMIT || "1000")));
const LOG_FORMAT = process.env.LOG_FORMAT || "text";
const RUN_ID = process.env.MIGRATION_RUN_ID || `run-${Date.now()}`;

const logAsJson = LOG_FORMAT === "json";

function nowIso() {
  return new Date().toISOString();
}

function emitLog(event, payload = {}) {
  if (logAsJson) {
    const envelope = {
      ts: nowIso(),
      runId: RUN_ID,
      event,
      dryRun: DRY_RUN,
      maxKeys: MAX_KEYS,
      limit: MAX_PER_PAGE,
      ...payload,
    };
    console.log(JSON.stringify(envelope));
  } else {
    const msg = `[${nowIso()}] [${event}] ${JSON.stringify(payload)}`;
    console.log(msg);
  }
}

function usage() {
  const usageText = `
Usage:
  export KV_NAMESPACE_ID=...\n  export CLOUDFLARE_ACCOUNT_ID=...\n  export CLOUDFLARE_API_TOKEN=...\n  node ./scripts/migrate-kv.mjs

Optional:
  DRY_RUN=1            do not write changes
  LOG_FORMAT=json      emit structured per-key and summary logs
  MIGRATE_CREATED_BY=foo  populate createdBy
  DEFAULT_TTL_SECONDS=86400  set default ttl for migrated legacy links
  MAX_KEYS=500          migrate at most N keys
  LIMIT=500             page size for key listing
  MIGRATION_RUN_ID=abc  optional run id for logs
`;
  console.error(usageText);
}

function isLikelyLegacyLinkValue(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return false;
    return false;
  } catch {
    return /^(https?|ftp):\/\//i.test(value.trim()) || /^mailto:/i.test(value.trim()) || /^tel:/i.test(value.trim());
  }
}

function isRecordValue(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return false;
    return (
      typeof parsed.slug === "string" &&
      typeof parsed.url === "string" &&
      typeof parsed.createdAt === "number" &&
      typeof parsed.updatedAt === "number"
    );
  } catch {
    return false;
  }
}

function isMigrateCandidateKey(keyName) {
  if (!keyName) return false;
  if (keyName.startsWith("rl:")) return false;
  if (keyName.startsWith("rate:")) return false;
  return /^[A-Za-z0-9_-]{3,64}$/.test(keyName);
}

function getExpiresAt() {
  if (Number.isFinite(DEFAULT_TTL_SECONDS) && DEFAULT_TTL_SECONDS > 0) {
    return Date.now() + DEFAULT_TTL_SECONDS * 1000;
  }
  return undefined;
}

async function cfRequest(path, options = {}) {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !KV_NAMESPACE_ID) {
    usage();
    throw new Error("Missing KV_NAMESPACE_ID, CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": options.body ? "application/json" : "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare API error: ${res.status} ${res.statusText}: ${body}`);
  }

  return res.json();
}

async function listKeys(cursor = "") {
  const qs = new URLSearchParams({
    limit: String(MAX_PER_PAGE),
  });
  if (cursor) qs.set("cursor", cursor);

  const payload = await cfRequest(`/keys?${qs.toString()}`);
  if (!payload.success) {
    throw new Error(`Cloudflare list error: ${JSON.stringify(payload.errors || payload)}`);
  }

  return payload;
}

async function getValue(keyName) {
  const path = `/values/${encodeURIComponent(keyName)}`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}${path}`, {
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Could not fetch key ${keyName}: ${res.status} ${res.statusText}: ${body}`);
  }

  return res.text();
}

async function putValue(keyName, value) {
  if (DRY_RUN) return;
  const path = `/values/${encodeURIComponent(keyName)}`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}${path}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: value,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to write key ${keyName}: ${res.status} ${res.statusText}: ${body}`);
  }
}

async function main() {
  const maxKeys = Number.isFinite(MAX_KEYS) && MAX_KEYS > 0 ? MAX_KEYS : Number.POSITIVE_INFINITY;
  let cursor = "";
  let migrated = 0;
  let errorCount = 0;
  let skippedNonCandidate = 0;
  let skippedAlreadyNormalized = 0;
  let skippedLegacyUnsupported = 0;
  let scanned = 0;
  let done = false;
  const startedAt = nowIso();

  emitLog("migration_start", { startedAt });

  while (!done) {
    const payload = await listKeys(cursor);
    const keys = payload.result || [];
    if (!keys.length) break;

    for (const item of keys) {
      if (scanned >= maxKeys) {
        done = true;
        break;
      }

      scanned += 1;
      const keyName = item.name || item.key;
      if (!isMigrateCandidateKey(keyName)) {
        skippedNonCandidate += 1;
        emitLog("key_skipped", {
          key: keyName,
          reason: "non_candidate",
          status: "skipped",
        });
        continue;
      }

      const raw = await getValue(keyName);
      if (!raw) {
        skippedLegacyUnsupported += 1;
        emitLog("key_skipped", {
          key: keyName,
          reason: "empty_value",
          status: "skipped",
        });
        continue;
      }

      if (isRecordValue(raw)) {
        skippedAlreadyNormalized += 1;
        emitLog("key_skipped", {
          key: keyName,
          reason: "already_normalized",
          status: "skipped",
        });
        continue;
      }

      if (!isLikelyLegacyLinkValue(raw)) {
        skippedLegacyUnsupported += 1;
        emitLog("key_skipped", {
          key: keyName,
          reason: "unsupported_value",
          status: "skipped",
        });
        continue;
      }

      const now = Date.now();
      const next = {
        slug: keyName,
        url: raw.trim(),
        createdAt: now,
        updatedAt: now,
        createdBy: CREATED_BY || undefined,
        disabled: false,
        customSlug: true,
        expiresAt: getExpiresAt(),
      };

      try {
        await putValue(keyName, JSON.stringify(next));
        migrated += 1;
        emitLog("key_migrated", {
          key: keyName,
          status: "migrated",
        });
      } catch (error) {
        errorCount += 1;
        emitLog("key_error", {
          key: keyName,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const info = payload.result_info || {};
    const nextCursor = info.cursor || "";
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }

  console.log("KV migration complete");
  console.log(` scanned=${scanned}`);
  console.log(` migrated=${migrated}`);
  console.log(` skipped_non_candidate=${skippedNonCandidate}`);
  console.log(` skipped_already_normalized=${skippedAlreadyNormalized}`);
  console.log(` skipped_unsupported=${skippedLegacyUnsupported}`);
  console.log(` errors=${errorCount}`);
  if (DRY_RUN) {
    console.log("DRY_RUN enabled: no writes were performed");
  }

  emitLog("migration_summary", {
    status: errorCount > 0 ? "error" : "ok",
    scanned,
    migrated,
    skippedNonCandidate,
    skippedAlreadyNormalized,
    skippedLegacyUnsupported,
    errors: errorCount,
    dryRun: DRY_RUN,
    finishedAt: nowIso(),
    maxKeys,
    limit: MAX_PER_PAGE,
  });
  if (errorCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
