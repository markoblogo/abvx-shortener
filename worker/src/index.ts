import { LANDING_HTML } from "./landing";
import { getConfig, WorkerEnv, type ResolvedConfig } from "./env";
import { canonicalizeUrlWithPrecheck } from "./validation/url";
import { json, jsonError, requestIdFromReq } from "./http/response";
import { authenticateRequest, hasPermission, isAllowedRequestOrigin } from "./auth/index";
import { rateLimitOk } from "./rateLimit/index";
import { sha256Base32 } from "./slug/generator";
import {
  RESERVED_SLUGS,
  LinkRecord,
  LinkEvent,
  addEvent,
  getLink,
  hardDeleteLink,
  listEvents,
  putExpiredOrDisabled,
  scanLinks,
  saveLink,
} from "./storage/links";
import { validateSlug } from "./storage/links";
import {
  listLinksQuerySchema,
  bulkLinkActionSchema,
  statsQuerySchema,
  eventsQuerySchema,
  exportQuerySchema,
  shortenRequestSchema,
  updateLinkRequestSchema,
} from "./validation/schemas";
import { incrementMetric, getStats } from "./storage/metrics";

const DEFAULT_SHORTEN_LENGTH = 6;
const COLLISION_SHORTEN_LENGTH = 10;

type TrustOperation = "shorten" | "read_link" | "manage_link" | "read_links" | "links_admin" | "stats" | "events" | "redirect";

function html(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(body, { ...init, headers });
}

function finalizeResponse(response: Response, request: Request, env: WorkerEnv): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");

  const origin = request.headers.get("origin");
  const cfg = getConfig(env);
  if (origin && isAllowedRequestOrigin(request, cfg.allowedOrigins, cfg.allowNoOrigin)) {
    headers.set("access-control-allow-origin", origin);
    headers.append("vary", "Origin");
  }

  if ((headers.get("content-type") || "").startsWith("text/html")) {
    headers.set(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function makeShortUrl(baseUrl: string, slug: string) {
  return `${baseUrl.replace(/\/$/, "")}/${slug}`;
}

function extractSlug(pathname: string): string {
  const value = pathname.replace(/^\//, "");
  try {
    return decodeURIComponent(value || "");
  } catch {
    return value || "";
  }
}

function parseJsonBody(req: Request) {
  return req.json().catch(() => null);
}

function mapError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Invalid request";
}

function getExpiresAt(ttl?: number, expiresAt?: string): number | undefined {
  if (ttl !== undefined) {
    return Date.now() + ttl * 1000;
  }
  if (expiresAt) {
    const ts = Date.parse(expiresAt);
    return Number.isNaN(ts) ? undefined : ts;
  }
  return undefined;
}

function shouldIncrementAfterRead(record: LinkRecord): LinkRecord {
  return {
    ...record,
    accessCount: (record.accessCount || 0) + 1,
    lastAccessAt: Date.now(),
    updatedAt: record.updatedAt,
    schemaVersion: record.schemaVersion || 1,
  };
}

function getActorId(request: Request, env: WorkerEnv, actor: Awaited<ReturnType<typeof authenticateRequest>>): string {
  return (actor ? actor.id : getDefaultActorId(request, env)) || "anonymous";
}

function getDefaultActorId(_request: Request, env: WorkerEnv): string {
  return `legacy-${env.API_KEY ? env.API_KEY.slice(0, 6) : "anon"}`;
}

function toManagedResponse(baseUrl: string, slug: string, requestId: string, record: LinkRecord, created: boolean, cfg: ResolvedConfig) {
  return json({
    slug,
    shortUrl: makeShortUrl(baseUrl, slug),
    url: record.url,
    created,
    alreadyExisted: !created,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    expiresAt: record.expiresAt,
    disabled: Boolean(record.disabled),
    customSlug: Boolean(record.customSlug),
    redirectType: record.redirectType || cfg.defaultRedirectType,
    fallbackUrl: record.fallbackUrl,
    private: Boolean(record.private),
    visibility: record.visibility || "public",
    requestId,
  });
}

function toLinkMeta(record: LinkRecord) {
  return {
    slug: record.slug,
    url: record.url,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    expiresAt: record.expiresAt,
    disabled: Boolean(record.disabled),
    customSlug: Boolean(record.customSlug),
    redirectType: record.redirectType,
    fallbackUrl: record.fallbackUrl,
    private: Boolean(record.private),
    privateTokenRequired: Boolean(record.privateTokenRequired),
    visibility: record.visibility || "public",
  };
}

async function emitAudit(namespace: KVNamespace, event: Omit<LinkEvent, "ts">, retentionDays: number) {
  await addEvent(namespace, { ...event, ts: Date.now() }, retentionDays);
}

function shouldReturnJson(request: Request): boolean {
  const accept = (request.headers.get("accept") || "").toLowerCase();
  return accept.includes("application/json") || accept.includes("text/json");
}

function prefersCode410(request: Request): boolean {
  return (request.headers.get("prefer") || "").toLowerCase().includes("code=410");
}

function fallbackResponse(status: number, request: Request, requestId: string, reason: string, fallbackUrl?: string) {
  if (fallbackUrl) {
    return Response.redirect(fallbackUrl, 302);
  }

  if (shouldReturnJson(request)) {
    return jsonError("not_found", reason, requestId, status);
  }

  const isHtml = (request.headers.get("accept") || "").toLowerCase().includes("text/html");
  if (isHtml) {
    return html(
      `<!doctype html><html><body><h1>${status} ${reason}</h1><p>RequestId: ${requestId}</p></body></html>`,
      { status },
    );
  }

  return new Response(reason, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function isPrivateAllowed(
  actor: Awaited<ReturnType<typeof authenticateRequest>>,
  link: LinkRecord,
): boolean {
  if (!link.private) return true;
  if (!actor) return false;
  if (!link.privateTokenRequired) return true;
  return actor.role === "admin" || actor.id === link.createdBy;
}

async function ensureAuthorized(
  request: Request,
  env: WorkerEnv,
  requestId: string,
  operation: TrustOperation,
): Promise<
  | { ok: true; actor: Awaited<ReturnType<typeof authenticateRequest>> }
  | { ok: false; response: Response }
> {
  const cfg = getConfig(env);
  if (!isAllowedRequestOrigin(request, cfg.allowedOrigins, cfg.allowNoOrigin)) {
    return { ok: false, response: jsonError("forbidden", "Origin is not allowed", requestId, 403) };
  }

  if (operation === "redirect") {
    return { ok: true, actor: null };
  }

  if (operation === "stats" && cfg.trustMode === "readonly-create") {
    return { ok: false, response: jsonError("forbidden", "Operation is disabled in readonly-create mode", requestId, 403) };
  }

  const actor = await authenticateRequest(request, env);
  if (!actor) {
    return { ok: false, response: jsonError("unauthorized", "Invalid API key", requestId, 401) };
  }

  if (!hasPermission(actor, operation, cfg.trustMode)) {
    return { ok: false, response: jsonError("forbidden", "Operation is not allowed in current trust mode or role", requestId, 403) };
  }

  return { ok: true, actor };
}

async function ensureRateLimitAllowed(
  request: Request,
  env: WorkerEnv,
  requestId: string,
): Promise<Response | null> {
  const cfg = getConfig(env);
  const allowed = await rateLimitOk(env, request, cfg.rateLimitWindowSec, cfg.rateLimitMax);
  if (!allowed) {
    await incrementMetric(env.LINKS, "rate_limited", "minute");
    return jsonError("rate_limited", "Rate limit exceeded", requestId, 429);
  }

  return null;
}

async function handleShorten(request: Request, env: WorkerEnv, requestId: string): Promise<Response> {
  const cfg = getConfig(env);
  const authorization = await ensureAuthorized(request, env, requestId, "shorten");
  if (!authorization.ok) return authorization.response;

  const rateLimitError = await ensureRateLimitAllowed(request, env, requestId);
  if (rateLimitError) return rateLimitError;

  const body = await parseJsonBody(request);
  if (!body || typeof body !== "object") {
    return jsonError("bad_request", "Invalid JSON", requestId, 400);
  }

  const parsed = shortenRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid request", requestId, 400, {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }

  let normalizedUrl: string;
  let normalizedFallbackUrl: string | undefined;
  try {
    normalizedUrl = await canonicalizeUrlWithPrecheck(parsed.data.url, env, {
      stripTrailingSlash: cfg.stripTrailingSlash,
      maxLength: cfg.maxUrlLength,
      trustConfig: {
        allowUrlDomains: cfg.allowUrlDomains,
        denyUrlDomains: cfg.denyUrlDomains,
      },
    });
    normalizedFallbackUrl = parsed.data.fallbackUrl
      ? await canonicalizeUrlWithPrecheck(parsed.data.fallbackUrl, env, {
          stripTrailingSlash: cfg.stripTrailingSlash,
          maxLength: cfg.maxUrlLength,
          trustConfig: {
            allowUrlDomains: cfg.allowUrlDomains,
            denyUrlDomains: cfg.denyUrlDomains,
          },
        })
      : undefined;
  } catch (err) {
    await incrementMetric(env.LINKS, "api_conflict", "minute");
    return jsonError("bad_request", mapError(err), requestId, 400);
  }

  const requestedSlug = parsed.data.customSlug?.trim().toLowerCase();
  const key = getDefaultActorId(request, env);
  const actor = authorization.actor;
  const actorId = actor?.id || key;

  if (requestedSlug) {
    if (RESERVED_SLUGS.has(requestedSlug.toLowerCase())) {
      await incrementMetric(env.LINKS, "api_conflict", "minute");
      return jsonError("bad_request", "Reserved slug", requestId, 400);
    }
    if (!validateSlug(requestedSlug)) {
      await incrementMetric(env.LINKS, "api_conflict", "minute");
      return jsonError("bad_request", "Invalid custom slug", requestId, 400);
    }

    const existing = await getLink(env.LINKS, requestedSlug, true, true);
    if (existing) {
      if (actor?.role !== "admin" && actor?.id !== existing.createdBy) {
        return jsonError("forbidden", "Writers can only reuse or overwrite links they created", requestId, 403);
      }
      if (existing.url === normalizedUrl && existing.disabled !== true) {
        return toManagedResponse(env.BASE_URL, requestedSlug, requestId, existing, false, cfg);
      }
      if (!parsed.data.overwrite && !parsed.data.force) {
        await incrementMetric(env.LINKS, "api_conflict", "minute");
        return jsonError("conflict", "Slug already exists", requestId, 409);
      }
      const before = existing;
      const now = Date.now();
      const next: LinkRecord = {
        ...existing,
        url: normalizedUrl,
        updatedAt: now,
        createdBy: actorId,
        expiresAt: getExpiresAt(parsed.data.ttl, parsed.data.expiresAt),
        redirectType: parsed.data.redirectType || cfg.defaultRedirectType,
        fallbackUrl: normalizedFallbackUrl,
        private: parsed.data.private || false,
        privateTokenRequired: parsed.data.privateTokenRequired ?? false,
        visibility: parsed.data.visibility || (parsed.data.private ? "private" : "public"),
      };
      await saveLink(env.LINKS, next);
      await emitAudit(env.LINKS, {
        type: "update",
        slug: requestedSlug,
        actor: actorId,
        before,
        after: next,
        source: "api",
        requestId,
      }, cfg.statsRetentionDays);
      await incrementMetric(env.LINKS, "updated", "minute");
      return toManagedResponse(env.BASE_URL, requestedSlug, requestId, next, false, cfg);
    }

    const next: LinkRecord = {
      slug: requestedSlug,
      url: normalizedUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: actorId,
      expiresAt: getExpiresAt(parsed.data.ttl, parsed.data.expiresAt),
      disabled: false,
      customSlug: true,
      redirectType: parsed.data.redirectType || cfg.defaultRedirectType,
      fallbackUrl: normalizedFallbackUrl,
      private: parsed.data.private || false,
      privateTokenRequired: parsed.data.privateTokenRequired ?? false,
      visibility: parsed.data.visibility || (parsed.data.private ? "private" : "public"),
    };

    await saveLink(env.LINKS, next);
    await emitAudit(env.LINKS, { type: "create", slug: requestedSlug, actor: actorId, before: null, after: next, source: "api", requestId }, cfg.statsRetentionDays);
    await incrementMetric(env.LINKS, "created", "minute");
    return toManagedResponse(env.BASE_URL, requestedSlug, requestId, next, true, cfg);
  }

  const hash = await sha256Base32(normalizedUrl);
  const preferred = hash.slice(0, DEFAULT_SHORTEN_LENGTH);
  const fallback = hash.slice(0, COLLISION_SHORTEN_LENGTH);

  const existing = await getLink(env.LINKS, preferred, true, true);
  if (!existing) {
    const next: LinkRecord = {
      slug: preferred,
      url: normalizedUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: actorId,
      expiresAt: getExpiresAt(parsed.data.ttl, parsed.data.expiresAt),
      disabled: false,
      customSlug: false,
      redirectType: parsed.data.redirectType || cfg.defaultRedirectType,
      fallbackUrl: normalizedFallbackUrl,
      private: parsed.data.private || false,
      privateTokenRequired: parsed.data.privateTokenRequired ?? false,
      visibility: parsed.data.visibility || (parsed.data.private ? "private" : "public"),
    };
    await saveLink(env.LINKS, next);
    await emitAudit(env.LINKS, { type: "create", slug: preferred, actor: actorId, before: null, after: next, source: "api", requestId }, cfg.statsRetentionDays);
    await incrementMetric(env.LINKS, "created", "minute");
    return toManagedResponse(env.BASE_URL, preferred, requestId, next, true, cfg);
  }

  if (existing.url === normalizedUrl && existing.disabled !== true) {
    return toManagedResponse(env.BASE_URL, preferred, requestId, existing, false, cfg);
  }

  const fallbackExisting = await getLink(env.LINKS, fallback, true, true);
  if (fallbackExisting) {
    if (fallbackExisting.url === normalizedUrl && fallbackExisting.disabled !== true) {
      return toManagedResponse(env.BASE_URL, fallback, requestId, fallbackExisting, false, cfg);
    }
    await incrementMetric(env.LINKS, "api_conflict", "minute");
    return jsonError("conflict", "Slug collision", requestId, 409);
  }

  const next = {
    slug: fallback,
    url: normalizedUrl,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: actorId,
    expiresAt: getExpiresAt(parsed.data.ttl, parsed.data.expiresAt),
    disabled: false,
    customSlug: false,
    redirectType: parsed.data.redirectType || cfg.defaultRedirectType,
    fallbackUrl: normalizedFallbackUrl,
    private: parsed.data.private || false,
    privateTokenRequired: parsed.data.privateTokenRequired ?? false,
    visibility: parsed.data.visibility || (parsed.data.private ? "private" : "public"),
  };
  await saveLink(env.LINKS, next);
  await emitAudit(env.LINKS, { type: "create", slug: fallback, actor: actorId, before: null, after: next, source: "api", requestId }, cfg.statsRetentionDays);
  await incrementMetric(env.LINKS, "created", "minute");

  return toManagedResponse(env.BASE_URL, fallback, requestId, next, true, cfg);
}

async function handleGetLink(slug: string, env: WorkerEnv, requestId: string, request: Request): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "read_link");
  if (!authorization.ok) return authorization.response;

  if (!validateSlug(slug) && !/^[a-z0-9]{6,10}$/i.test(slug)) {
    return jsonError("bad_request", "Invalid slug", requestId, 400);
  }

  const link = await getLink(env.LINKS, slug, true, true);
  if (!link) {
    await incrementMetric(env.LINKS, "redirect_miss", "minute");
    return jsonError("not_found", "Link not found", requestId, 404);
  }

  return json({
    ...toLinkMeta(link),
    requestId,
  });
}

async function handleUpdateLink(slug: string, env: WorkerEnv, requestId: string, request: Request): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "manage_link");
  if (!authorization.ok) return authorization.response;

  const cfg = getConfig(env);
  const actor = authorization.actor;
  const body = await parseJsonBody(request);
  if (!body || typeof body !== "object") {
    return jsonError("bad_request", "Invalid JSON", requestId, 400);
  }

  const parsed = updateLinkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid request", requestId, 400);
  }

  if (!validateSlug(slug)) {
    return jsonError("bad_request", "Invalid slug", requestId, 400);
  }

  const existing = await getLink(env.LINKS, slug, true, true);
  if (!existing) {
    return jsonError("not_found", "Link not found", requestId, 404);
  }

  if (actor?.role !== "admin" && actor?.id !== existing.createdBy) {
    return jsonError("forbidden", "Writers can only modify links they created", requestId, 403);
  }

  const canonicalizeManagedUrl = (value: string) =>
    canonicalizeUrlWithPrecheck(value, env, {
        stripTrailingSlash: cfg.stripTrailingSlash,
        maxLength: cfg.maxUrlLength,
        trustConfig: {
          allowUrlDomains: cfg.allowUrlDomains,
          denyUrlDomains: cfg.denyUrlDomains,
        },
      });
  let nextUrl: string;
  let nextFallbackUrl: string | undefined;
  try {
    nextUrl = parsed.data.url ? await canonicalizeManagedUrl(parsed.data.url) : existing.url;
    nextFallbackUrl = parsed.data.fallbackUrl
      ? await canonicalizeManagedUrl(parsed.data.fallbackUrl)
      : parsed.data.fallbackUrl === ""
        ? undefined
        : existing.fallbackUrl;
  } catch (error) {
    return jsonError("bad_request", mapError(error), requestId, 400);
  }

  if (parsed.data.url && existing.url !== nextUrl && !parsed.data.overwrite && !parsed.data.force) {
    await incrementMetric(env.LINKS, "api_conflict", "minute");
    return jsonError("conflict", "Need overwrite/force to change url", requestId, 409);
  }

  const next: LinkRecord = {
    ...existing,
    url: nextUrl,
    disabled: parsed.data.disabled ?? existing.disabled,
    expiresAt: parsed.data.expiresAt
      ? Date.parse(parsed.data.expiresAt)
      : parsed.data.ttl
        ? Date.now() + parsed.data.ttl * 1000
        : existing.expiresAt,
    redirectType: parsed.data.redirectType || existing.redirectType,
    fallbackUrl: nextFallbackUrl,
    private: parsed.data.private ?? existing.private,
    privateTokenRequired: parsed.data.privateTokenRequired ?? existing.privateTokenRequired,
    visibility: parsed.data.visibility || existing.visibility,
    updatedAt: Date.now(),
    createdBy: existing.createdBy,
    customSlug: existing.customSlug,
    createdAt: existing.createdAt,
  };

  if (parsed.data.url && parsed.data.url !== existing.url) {
    next.redirectType = parsed.data.redirectType || cfg.defaultRedirectType;
  }

  await saveLink(env.LINKS, next);
  await emitAudit(
    env.LINKS,
    {
      type: existing.disabled && !next.disabled ? "restore" : "update",
      slug,
      actor: actor?.id || getActorId(request, env, actor),
      before: existing,
      after: next,
      source: "api",
      requestId,
    },
    cfg.statsRetentionDays,
  );
  await incrementMetric(env.LINKS, "updated", "minute");

  return json({
    ...toLinkMeta(next),
    requestId,
  });
}

async function handleDeleteLink(slug: string, env: WorkerEnv, requestId: string, request: Request): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "manage_link");
  if (!authorization.ok) return authorization.response;

  const cfg = getConfig(env);
  const actor = authorization.actor;
  if (!validateSlug(slug)) {
    return jsonError("bad_request", "Invalid slug", requestId, 400);
  }

  const existing = await getLink(env.LINKS, slug, true, true);
  if (!existing) {
    return jsonError("not_found", "Link not found", requestId, 404);
  }

  if (actor?.role !== "admin" && actor?.id !== existing.createdBy) {
    return jsonError("forbidden", "Writers can only delete links they created", requestId, 403);
  }

  const hard = new URL(request.url).searchParams.get("hard") === "true";
  if (hard) {
    await hardDeleteLink(env.LINKS, slug);
    await emitAudit(
      env.LINKS,
      {
        type: "delete",
        slug,
        actor: actor?.id || getActorId(request, env, actor),
        before: existing,
        after: null,
        source: "api",
        requestId,
      },
      cfg.statsRetentionDays,
    );
    await incrementMetric(env.LINKS, "deleted", "minute");
    return json({ slug, deleted: true, hard, requestId });
  }

  await putExpiredOrDisabled(env.LINKS, slug, true);
  await emitAudit(
    env.LINKS,
    {
      type: "soft-delete",
      slug,
      actor: actor?.id || getActorId(request, env, actor),
      before: existing,
      after: { ...existing, disabled: true, updatedAt: Date.now() },
      source: "api",
      requestId,
    },
    cfg.statsRetentionDays,
  );
  await incrementMetric(env.LINKS, "updated", "minute");

  return json({ slug, disabled: true, requestId });
}

function parseCursor(raw: string | null): string {
  return raw || "";
}

async function handleListLinks(request: Request, env: WorkerEnv, requestId: string): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "read_links");
  if (!authorization.ok) return authorization.response;

  const parsed = listLinksQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid query", requestId, 400);
  }

  const now = Date.now();
  const limit = parsed.data.limit || 50;
  const normalizedQ = parsed.data.q?.trim().toLowerCase();
  const startCursor = parseCursor(parsed.data.cursor || null);

  const result = await scanLinks(env.LINKS, {
    cursor: startCursor,
    limit,
    includeDisabled: true,
    includeExpired: true,
    predicate: (record) => {
      if (parsed.data.disabled !== undefined && Boolean(record.disabled) !== parsed.data.disabled) {
        return false;
      }

      const expired = Boolean(record.expiresAt && record.expiresAt <= now);
      if (parsed.data.expired !== undefined && expired !== parsed.data.expired) {
        return false;
      }

      if (parsed.data.customSlug !== undefined && Boolean(record.customSlug) !== parsed.data.customSlug) {
        return false;
      }

      if (parsed.data.createdBy && record.createdBy !== parsed.data.createdBy) {
        return false;
      }

      if (normalizedQ) {
        const haystack = `${record.slug.toLowerCase()} ${record.url.toLowerCase()}`;
        if (!haystack.includes(normalizedQ)) {
          return false;
        }
      }

      return true;
    },
  });

  return json({
    items: result.items.map(toLinkMeta),
    nextCursor: result.cursor ? encodeURIComponent(result.cursor) : undefined,
    done: result.done,
    limit,
    requestId,
  });
}

async function handleBulkLinks(request: Request, env: WorkerEnv, requestId: string): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "links_admin");
  if (!authorization.ok) return authorization.response;

  const cfg = getConfig(env);
  const body = await parseJsonBody(request);
  if (!body || typeof body !== "object") {
    return jsonError("bad_request", "Invalid JSON", requestId, 400);
  }

  const parsed = bulkLinkActionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid request", requestId, 400);
  }

  const actor = authorization.actor;
  const updated: Array<{ slug: string; status: string; code?: number }> = [];

  for (const slug of parsed.data.slugs) {
    if (!validateSlug(slug)) {
      updated.push({ slug, status: "invalid" });
      continue;
    }

    const link = await getLink(env.LINKS, slug, true, true);
    if (!link) {
      updated.push({ slug, status: "not_found", code: 404 });
      continue;
    }

    if (parsed.data.dryRun) {
      updated.push({ slug, status: "dry_run_ok" });
      continue;
    }

    if (parsed.data.action === "disable") {
      await putExpiredOrDisabled(env.LINKS, slug, true);
      await emitAudit(
        env.LINKS,
        {
          type: "update",
          slug,
          actor: actor?.id || getActorId(request, env, actor),
          before: link,
          after: { ...link, disabled: true, updatedAt: Date.now() },
          source: "api",
          requestId,
        },
        cfg.statsRetentionDays,
      );
      await incrementMetric(env.LINKS, "updated", "minute");
    }

    if (parsed.data.action === "restore") {
      await saveLink(env.LINKS, { ...link, disabled: false, updatedAt: Date.now() });
      await emitAudit(
        env.LINKS,
        {
          type: "restore",
          slug,
          actor: actor?.id || getActorId(request, env, actor),
          before: link,
          after: { ...link, disabled: false, updatedAt: Date.now() },
          source: "api",
          requestId,
        },
        cfg.statsRetentionDays,
      );
      await incrementMetric(env.LINKS, "updated", "minute");
    }

    if (parsed.data.action === "delete") {
      await hardDeleteLink(env.LINKS, slug);
      await emitAudit(
        env.LINKS,
        {
          type: "delete",
          slug,
          actor: actor?.id || getActorId(request, env, actor),
          before: link,
          after: null,
          source: "api",
          requestId,
        },
        cfg.statsRetentionDays,
      );
      await incrementMetric(env.LINKS, "deleted", "minute");
    }

    updated.push({ slug, status: parsed.data.dryRun ? "dry_run_ok" : "ok" });
  }

  return json({
    action: parsed.data.action,
    dryRun: parsed.data.dryRun,
    results: updated,
    requestId,
  });
}

function linksToCsv(rows: ReturnType<typeof toLinkMeta>[]) {
  const header = [
    "slug",
    "url",
    "createdAt",
    "updatedAt",
    "createdBy",
    "expiresAt",
    "disabled",
    "customSlug",
    "redirectType",
    "fallbackUrl",
    "private",
    "privateTokenRequired",
    "visibility",
    "lastAccessAt",
    "accessCount",
  ];

  const rowsCsv = rows.map((item) =>
    [
      item.slug,
      item.url,
      String(item.createdAt || ""),
      String(item.updatedAt || ""),
      item.createdBy || "",
      String(item.expiresAt || ""),
      String(item.disabled || false),
      String(item.customSlug || false),
      item.redirectType || "",
      item.fallbackUrl || "",
      String(item.private || false),
      String(item.privateTokenRequired || false),
      item.visibility || "public",
      String((item as any).lastAccessAt || ""),
      String((item as any).accessCount || ""),
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );

  return [
    header.map((value) => `"${value}"`).join(","),
    ...rowsCsv,
  ].join("\n");
}

async function handleExportLinks(request: Request, env: WorkerEnv, requestId: string): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "links_admin");
  if (!authorization.ok) return authorization.response;

  const parsed = exportQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid query", requestId, 400);
  }

  const now = Date.now();
  const limit = parsed.data.limit || 1000;
  const normalizedQ = parsed.data.q?.trim().toLowerCase();
  const startCursor = parseCursor(parsed.data.cursor || null);

  const result = await scanLinks(env.LINKS, {
    cursor: startCursor,
    limit,
    includeDisabled: true,
    includeExpired: true,
    predicate: (record) => {
      const expired = Boolean(record.expiresAt && record.expiresAt <= now);
      if (parsed.data.expired !== undefined && expired !== parsed.data.expired) return false;
      if (parsed.data.disabled !== undefined && Boolean(record.disabled) !== parsed.data.disabled) return false;
      if (parsed.data.customSlug !== undefined && Boolean(record.customSlug) !== parsed.data.customSlug) return false;
      if (parsed.data.createdBy && record.createdBy !== parsed.data.createdBy) return false;
      if (normalizedQ) {
        const haystack = `${record.slug.toLowerCase()} ${record.url.toLowerCase()}`;
        if (!haystack.includes(normalizedQ)) return false;
      }
      return true;
    },
  });

  const items = result.items.map(toLinkMeta);

  if (parsed.data.format === "csv") {
    return new Response(linksToCsv(items), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=abvx-links-export.csv",
      },
    });
  }

  return json({
    format: "json",
    items,
    nextCursor: result.cursor ? encodeURIComponent(result.cursor) : undefined,
    done: result.done,
    limit,
    requestId,
  });
}

async function handleEvents(request: Request, env: WorkerEnv, requestId: string): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "events");
  if (!authorization.ok) return authorization.response;

  const parsed = eventsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid query", requestId, 400);
  }

  const result = await listEvents(env.LINKS, parsed.data.cursor || "", parsed.data.limit || 50, parsed.data.type);

  return json({
    items: result.events,
    nextCursor: result.cursor ? encodeURIComponent(result.cursor) : undefined,
    done: result.done,
    requestId,
  });
}

async function handleStats(request: Request, env: WorkerEnv, requestId: string): Promise<Response> {
  const authorization = await ensureAuthorized(request, env, requestId, "stats");
  if (!authorization.ok) return authorization.response;

  const parsed = statsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return jsonError("bad_request", parsed.error.issues[0]?.message || "Invalid query", requestId, 400);
  }

  const now = Date.now();
  const since =
    parsed.data.since ??
    (parsed.data.window === "minute"
      ? now - 60 * 60 * 1000
      : parsed.data.window === "hour"
        ? now - 6 * 60 * 60 * 1000
        : now - 30 * 24 * 60 * 60 * 1000);
  const until = parsed.data.until ?? now;

  const bucketSize = parsed.data.window === "minute" ? 60_000 : parsed.data.window === "hour" ? 3_600_000 : 86_400_000;
  const bucketCount = Math.floor((until - since) / bucketSize) + 1;
  if (until < since || bucketCount > 500) {
    return jsonError("bad_request", "Stats range must contain between 1 and 500 buckets", requestId, 400);
  }

  const stats = await getStats(env.LINKS, parsed.data.window, since, until);

  return json({
    window: parsed.data.window,
    generatedAt: new Date(now).toISOString(),
    totals: stats.totals,
    buckets: stats.buckets,
    requestId,
  });
}

async function handleRedirect(
  slug: string,
  request: Request,
  env: WorkerEnv,
  requestId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const cfg = getConfig(env);
  if (!slug || slug === "api" || slug === "health") {
    return jsonError("not_found", "Not found", requestId, 404);
  }

  const link = await getLink(env.LINKS, slug, false, true);
  if (!link) {
    await incrementMetric(env.LINKS, "redirect_miss", "minute");
    return fallbackResponse(404, request, requestId, "Not found", undefined);
  }

  if (link.expiresAt && link.expiresAt <= Date.now()) {
    await incrementMetric(env.LINKS, "expired_hit", "minute");
    await env.LINKS.delete(slug);
    return fallbackResponse(prefersCode410(request) ? 410 : 404, request, requestId, "Link expired", link.fallbackUrl);
  }

  if (link.disabled) {
    await incrementMetric(env.LINKS, "disabled_hit", "minute");
    return fallbackResponse(prefersCode410(request) ? 410 : 404, request, requestId, "Link disabled", link.fallbackUrl);
  }

  const actor = await authenticateRequest(request, env);
  if (!isPrivateAllowed(actor, link)) {
    await incrementMetric(env.LINKS, "private_denied", "minute");
    return jsonError("unauthorized", "Private link requires an authorized token", requestId, actor ? 403 : 401);
  }

  const touched = shouldIncrementAfterRead(link);
  const postResponse = Promise.all([
    incrementMetric(env.LINKS, "redirect_hit", "minute"),
    saveLink(env.LINKS, touched),
  ]).then(() => undefined);
  if (ctx) {
    ctx.waitUntil(postResponse);
  } else {
    await postResponse;
  }

  const redirectType = link.redirectType || cfg.defaultRedirectType;
  return Response.redirect(link.url, Number(redirectType));
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx?: ExecutionContext): Promise<Response> {
    const requestId = requestIdFromReq(request);
    const url = new URL(request.url);
    const pathname = url.pathname;
    const normalizedPath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
    const finish = async (response: Response | Promise<Response>) => finalizeResponse(await response, request, env);

    try {
      if (request.method === "OPTIONS" && normalizedPath.startsWith("/api/")) {
        const cfg = getConfig(env);
        if (!isAllowedRequestOrigin(request, cfg.allowedOrigins, cfg.allowNoOrigin)) {
          return finish(jsonError("forbidden", "Origin is not allowed", requestId, 403));
        }
        return finish(
          new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
              "access-control-allow-headers": "Content-Type, X-API-Key, X-API-Key-Id",
              "access-control-max-age": "86400",
            },
          }),
        );
      }

      if (normalizedPath === "/" && (request.method === "GET" || request.method === "HEAD")) {
        return finish(html(LANDING_HTML, { status: 200 }));
      }

      if (normalizedPath === "/health") {
        return finish(json({ ok: true, version: "0.4.0", requestId }));
      }

      if (normalizedPath === "/api/shorten") {
        if (request.method !== "POST") {
          return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
        }
        return finish(handleShorten(request, env, requestId));
      }

      if (normalizedPath === "/api/links") {
        if (request.method === "GET") return finish(handleListLinks(request, env, requestId));
        return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
      }

      if (normalizedPath === "/api/links/bulk") {
        if (request.method === "POST") return finish(handleBulkLinks(request, env, requestId));
        return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
      }

      if (normalizedPath === "/api/links/export") {
        if (request.method === "GET") return finish(handleExportLinks(request, env, requestId));
        return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
      }

      if (normalizedPath === "/api/stats") {
        if (request.method === "GET") return finish(handleStats(request, env, requestId));
        return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
      }

      if (normalizedPath === "/api/events") {
        if (request.method === "GET") return finish(handleEvents(request, env, requestId));
        return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
      }

      if (normalizedPath.startsWith("/api/link/")) {
        const slug = extractSlug(normalizedPath.slice("/api/link/".length));
        if (!slug) {
          return finish(jsonError("bad_request", "Slug is required", requestId, 400));
        }

        if (request.method === "GET") return finish(handleGetLink(slug, env, requestId, request));
        if (request.method === "PUT") return finish(handleUpdateLink(slug, env, requestId, request));
        if (request.method === "DELETE") return finish(handleDeleteLink(slug, env, requestId, request));

        return finish(jsonError("method_not_allowed", "Method not allowed", requestId, 405));
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const slug = extractSlug(normalizedPath);
        return finish(handleRedirect(slug, request, env, requestId, ctx));
      }

      return finish(new Response("Not found", { status: 404 }));
    } catch (error) {
      return finish(jsonError("internal_error", mapError(error), requestId, 500));
    }
  },
};
