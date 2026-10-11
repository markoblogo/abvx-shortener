export const RESERVED_SLUGS = new Set([
  "api",
  "health",
  "assets",
  "favicon.ico",
  ".well-known",
  "robots.txt",
  "robots",
  "admin",
  "internal",
  "shorten",
  "links",
]);

const SYSTEM_PREFIXES = ["rl:", "rate:", "stats:", "evt:"];

const MIN_SLUG = 3;
const MAX_SLUG = 64;

export type RedirectType = "302" | "301";

export interface LinkRecord {
  slug: string;
  url: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  expiresAt?: number;
  disabled?: boolean;
  customSlug?: boolean;
  redirectType?: RedirectType;
  fallbackUrl?: string;
  private?: boolean;
  privateTokenRequired?: boolean;
  visibility?: "public" | "private";
  lastAccessAt?: number;
  accessCount?: number;
  schemaVersion?: number;
}

interface RawLinkRecord {
  slug?: unknown;
  url?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: unknown;
  expiresAt?: unknown;
  disabled?: unknown;
  customSlug?: unknown;
  redirectType?: unknown;
  fallbackUrl?: unknown;
  private?: unknown;
  privateTokenRequired?: unknown;
  visibility?: unknown;
  lastAccessAt?: unknown;
  accessCount?: unknown;
  schemaVersion?: unknown;
}

export interface LinkEvent {
  type: "create" | "update" | "delete" | "soft-delete" | "restore";
  slug: string;
  actor: string;
  before?: Partial<LinkRecord> | null;
  after?: Partial<LinkRecord> | null;
  requestId: string;
  ts: number;
  source: "api";
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isRedirectType(value: unknown): value is RedirectType {
  return value === "301" || value === "302";
}

function isVisibility(value: unknown): value is "public" | "private" {
  return value === "public" || value === "private";
}

export async function getKVRecord(namespace: KVNamespace, key: string): Promise<string | null> {
  return namespace.get(key);
}

export function normalizeRecord(slug: string, input: string | null): LinkRecord | null {
  if (!input) return null;

  try {
    const parsed = JSON.parse(input) as RawLinkRecord;
    if (
      !parsed ||
      !isString(parsed.url) ||
      !parsed.slug ||
      !isString(parsed.slug) ||
      !isNumber(parsed.createdAt) ||
      !isNumber(parsed.updatedAt)
    ) {
      return null;
    }

    return {
      slug: parsed.slug,
      url: parsed.url,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      createdBy: isString(parsed.createdBy) ? parsed.createdBy : undefined,
      expiresAt: isNumber(parsed.expiresAt) ? parsed.expiresAt : undefined,
      disabled: isBoolean(parsed.disabled) ? parsed.disabled : false,
      customSlug: isBoolean(parsed.customSlug) ? parsed.customSlug : undefined,
      redirectType: isRedirectType(parsed.redirectType) ? parsed.redirectType : undefined,
      fallbackUrl: isString(parsed.fallbackUrl) ? parsed.fallbackUrl : undefined,
      private: isBoolean(parsed.private) ? parsed.private : undefined,
      privateTokenRequired: isBoolean(parsed.privateTokenRequired) ? parsed.privateTokenRequired : undefined,
      visibility: isVisibility(parsed.visibility) ? parsed.visibility : undefined,
      lastAccessAt: isNumber(parsed.lastAccessAt) ? parsed.lastAccessAt : undefined,
      accessCount: isNumber(parsed.accessCount) ? parsed.accessCount : undefined,
      schemaVersion: isNumber(parsed.schemaVersion) ? parsed.schemaVersion : undefined,
    };
  } catch {
    return {
      slug,
      url: input,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      disabled: false,
      customSlug: false,
    };
  }
}

export function validateSlug(slug: string): boolean {
  if (slug.length < MIN_SLUG || slug.length > MAX_SLUG) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return false;
  return true;
}

export function isSystemLinkKey(keyName: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => keyName.startsWith(prefix));
}

export async function getLink(namespace: KVNamespace, slug: string, includeDisabled = false, includeExpired = false): Promise<LinkRecord | null> {
  const raw = await namespace.get(slug);
  const normalized = normalizeRecord(slug, raw);
  if (!normalized) return null;

  if (!includeDisabled && normalized.disabled) {
    return null;
  }

  if (!includeExpired && normalized.expiresAt && normalized.expiresAt <= Date.now()) {
    return null;
  }

  return normalized;
}

export async function saveLink(namespace: KVNamespace, record: LinkRecord): Promise<void> {
  if (!record.schemaVersion) {
    record.schemaVersion = 1;
  }

  await namespace.put(record.slug, JSON.stringify(record));
}

export async function putExpiredOrDisabled(namespace: KVNamespace, slug: string, disabled = true): Promise<void> {
  const existing = await getLink(namespace, slug, true, true);
  if (!existing) return;
  existing.disabled = disabled;
  existing.updatedAt = Date.now();
  await namespace.put(slug, JSON.stringify(existing));
}

export async function hardDeleteLink(namespace: KVNamespace, slug: string): Promise<void> {
  await namespace.delete(slug);
}

export async function listLinkKeys(namespace: KVNamespace, cursor: string = "", limit: number = 100): Promise<{ keys: string[]; cursor: string; done: boolean }> {
  const result = await namespace.list({
    cursor: cursor || undefined,
    limit,
  });
  const nextCursor = (result as { cursor?: string }).cursor || "";
  const names = (result.keys || []).map((item) => item.name).filter(Boolean) as string[];
  const links = names.filter((name) => !isSystemLinkKey(name));
  return {
    keys: links,
    cursor: nextCursor,
    done: result.list_complete,
  };
}

export async function scanLinks(
  namespace: KVNamespace,
  opts: {
    cursor?: string;
    limit?: number;
    includeDisabled?: boolean;
    includeExpired?: boolean;
    predicate?: (_record: LinkRecord) => boolean;
  },
): Promise<{ items: LinkRecord[]; cursor: string; done: boolean }> {
  const pageSize = Math.max(1, Math.min(opts.limit || 100, 500));
  let cursor = opts.cursor || "";
  const output: LinkRecord[] = [];

  while (true) {
    const result = await listLinkKeys(namespace, cursor, pageSize);
    for (const name of result.keys) {
      if (!validateSlug(name)) {
        continue;
      }

      const record = await getLink(
        namespace,
        name,
        opts.includeDisabled ?? true,
        opts.includeExpired ?? true,
      );
      if (!record) {
        continue;
      }

      if (opts.predicate && !opts.predicate(record)) {
        continue;
      }
      output.push(record);
    }

    if (output.length >= pageSize || result.done) {
      return { items: output, cursor: result.done ? "" : result.cursor, done: result.done };
    }

    if (!result.cursor) {
      return { items: output, cursor: "", done: true };
    }
    cursor = result.cursor;
  }
}

export async function addEvent(namespace: KVNamespace, event: LinkEvent, retentionDays: number): Promise<void> {
  const safeTs = String(event.ts).padStart(16, "0");
  const key = `evt:${safeTs}:${event.requestId || "request"}:${event.slug}`;
  const ttl = Math.max(86400, retentionDays * 24 * 60 * 60);
  await namespace.put(key, JSON.stringify(event), { expirationTtl: ttl });
}

export async function listEvents(
  namespace: KVNamespace,
  cursor: string = "",
  limit: number = 50,
  typeFilter?: string,
): Promise<{ events: LinkEvent[]; cursor: string; done: boolean }> {
  const keysResult = await namespace.list({
    prefix: "evt:",
    cursor: cursor || undefined,
    limit,
  });
  const nextCursor = (keysResult as { cursor?: string }).cursor || "";

  const events: LinkEvent[] = [];
  for (const item of keysResult.keys || []) {
    const key = item.name;
    const raw = await namespace.get(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as LinkEvent;
      if (typeFilter && parsed.type !== typeFilter) continue;
      events.push(parsed);
    } catch {
      continue;
    }
  }

  return { events, cursor: nextCursor, done: keysResult.list_complete };
}

export { MIN_SLUG, MAX_SLUG };
