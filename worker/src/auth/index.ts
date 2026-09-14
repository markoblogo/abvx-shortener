import type { WorkerEnv } from "../env";
import { type TrustMode } from "../env";

export type ApiRole = "admin" | "writer" | "reader";

export interface ApiActor {
  id: string;
  role: ApiRole;
  requestApiKey: string;
}

function extractOrigin(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "chrome-extension:") {
      return `chrome-extension://${parsed.host.toLowerCase()}`;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return "";
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function parseApiKeys(raw: string): Array<{ id: string; role: ApiRole; secret?: string; secret_hash?: string }> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const keys = parsed.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
      if (!(["reader", "writer", "admin"] as const).includes(candidate.role as ApiRole)) return null;
      const secret = typeof candidate.secret === "string" && candidate.secret ? candidate.secret : undefined;
      const secretHash = typeof candidate.secret_hash === "string" && candidate.secret_hash ? candidate.secret_hash.toLowerCase() : undefined;
      if ((!secret && !secretHash) || (secretHash && !/^sha256:[a-f0-9]{64}$/.test(secretHash))) return null;
      return { id: candidate.id, role: candidate.role as ApiRole, secret, secret_hash: secretHash };
    });

    return keys.some((key) => key === null) ? null : (keys as Array<{ id: string; role: ApiRole; secret?: string; secret_hash?: string }>);
  } catch {
    return null;
  }
}

export function getApiKey(request: Request): string {
  return request.headers.get("X-API-Key") || "";
}

export async function getActorIdFromKey(key: string): Promise<string> {
  return key ? `legacy-${(await sha256Hex(key)).slice(0, 12)}` : "anonymous";
}

export function isAllowedRequestOrigin(request: Request, allowedOrigins: string[], allowNoOrigin: boolean): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const candidate = extractOrigin(origin || "") || extractOrigin(referer || "");

  if (!candidate) {
    return allowNoOrigin;
  }

  const ownOrigin = new URL(request.url).origin.toLowerCase();
  if (candidate === ownOrigin) {
    return true;
  }

  if (candidate.startsWith("chrome-extension://")) {
    const configuredExtensions = allowedOrigins.filter((item) => item.startsWith("chrome-extension://"));
    return configuredExtensions.length === 0 || configuredExtensions.includes(candidate);
  }

  return allowedOrigins.includes(candidate);
}

export async function authenticateRequest(request: Request, env: WorkerEnv): Promise<ApiActor | null> {
  const key = getApiKey(request);
  if (!key) {
    return null;
  }

  if (
    env.GIT_TWEET_API_KEY &&
    request.headers.get("X-API-Key-Id") === "git-tweet" &&
    safeEquals(key, env.GIT_TWEET_API_KEY)
  ) {
    return { id: "git-tweet", role: "writer", requestApiKey: key };
  }

  const rawKeyConfig = env.API_KEYS_JSON?.trim();
  if (rawKeyConfig) {
    const configuredKeys = parseApiKeys(rawKeyConfig);
    if (!configuredKeys) return null;
    const keyId = request.headers.get("X-API-Key-Id") || "";
    if (!keyId) {
      return null;
    }

    const match = configuredKeys.find((item) => item.id === keyId);
    if (!match) {
      return null;
    }

    if (match.secret_hash) {
      const hashed = `sha256:${await sha256Hex(key)}`;
      if (safeEquals(hashed, match.secret_hash)) {
        return { id: match.id, role: match.role, requestApiKey: key };
      }
      return null;
    }

    if (match.secret && safeEquals(key, match.secret)) {
      return { id: match.id, role: match.role, requestApiKey: key };
    }
    return null;
  }

  if (env.API_KEY && safeEquals(key, env.API_KEY)) {
    return {
      id: await getActorIdFromKey(key),
      role: "admin",
      requestApiKey: key,
    };
  }

  return null;
}

export function hasPermission(actor: ApiActor | null, operation: string, configMode: TrustMode): boolean {
  if (!actor) return false;

  const isReadOnly = configMode === "readonly";
  const isReadOnlyCreate = configMode === "readonly-create";

  if (isReadOnlyCreate && operation !== "shorten" && operation !== "redirect") {
    return false;
  }

  if (
    isReadOnly &&
    operation !== "read_link" &&
    operation !== "read_links" &&
    operation !== "stats" &&
    operation !== "events" &&
    operation !== "redirect"
  ) {
    return false;
  }

  if (actor.role === "admin") {
    return true;
  }

  if (actor.role === "writer") {
    return (
      operation === "shorten" ||
      operation === "read_link" ||
      operation === "manage_link" ||
      operation === "read_links"
    );
  }

  return operation === "read_link" || operation === "read_links" || operation === "redirect";
}
