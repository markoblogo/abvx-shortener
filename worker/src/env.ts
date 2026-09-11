export type TrustMode = "personal" | "readonly" | "readonly-create";
type ConfigScalar = string | number | boolean;

export interface WorkerEnv {
  LINKS: KVNamespace;
  RATE_LIMITER?: RateLimit;
  API_KEY?: string;
  BASE_URL: string;
  RATE_LIMIT_WINDOW_SEC?: ConfigScalar;
  RATE_LIMIT_MAX?: ConfigScalar;
  ALLOWED_ORIGINS?: string;
  ALLOW_NO_ORIGIN?: ConfigScalar;
  STRIP_TRAILING_SLASH?: ConfigScalar;
  MAX_URL_LENGTH?: ConfigScalar;
  DEFAULT_TTL_SECONDS?: ConfigScalar;
  TRUST_MODE?: string;
  ALLOW_URL_DOMAINS?: string;
  DENY_URL_DOMAINS?: string;
  URL_PRECHECK_URL?: string;
  URL_PRECHECK_TIMEOUT_MS?: ConfigScalar;
  URL_PRECHECK_FAIL_OPEN?: ConfigScalar;
  DEFAULT_REDIRECT_TYPE?: string;
  STATS_RETENTION_DAYS?: ConfigScalar;
  API_KEYS_JSON?: string;
}

export interface ResolvedConfig {
  rateLimitWindowSec: number;
  rateLimitMax: number;
  allowedOrigins: string[];
  allowNoOrigin: boolean;
  stripTrailingSlash: boolean;
  maxUrlLength: number;
  defaultTtlSeconds: number;
  trustMode: TrustMode;
  allowUrlDomains: string[];
  denyUrlDomains: string[];
  urlPrecheckUrl: string | undefined;
  urlPrecheckTimeoutMs: number;
  urlPrecheckFailOpen: boolean;
  defaultRedirectType: "302" | "301";
  statsRetentionDays: number;
}

function normalizeDomainList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/^\./, ""));
}

function parseTrustMode(raw: string | undefined): TrustMode {
  if (raw === "readonly" || raw === "readonly-create") return raw;
  return "personal";
}

function parsePositiveInt(raw: ConfigScalar | undefined, fallback: number, min = 1): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.floor(parsed);
}

function isTrue(raw: ConfigScalar | undefined, fallback = false): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw === true || raw === 1 || raw === "1" || raw === "true";
}

export function getConfig(env: WorkerEnv): ResolvedConfig {
  const rateLimitWindowSec = parsePositiveInt(env.RATE_LIMIT_WINDOW_SEC, 60);
  const rateLimitMax = parsePositiveInt(env.RATE_LIMIT_MAX, 30);
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .map((v) => v.replace(/\/$/, ""));

  const allowUrlDomains = normalizeDomainList(env.ALLOW_URL_DOMAINS || "");
  const denyUrlDomains = normalizeDomainList(env.DENY_URL_DOMAINS || "");
  const urlPrecheckTimeoutMs = parsePositiveInt(env.URL_PRECHECK_TIMEOUT_MS, 1500, 100);
  const statsRetentionDays = parsePositiveInt(env.STATS_RETENTION_DAYS, 30, 1);

  let defaultRedirectType: "302" | "301" = "302";
  if ((env.DEFAULT_REDIRECT_TYPE || "").toLowerCase() === "301") {
    defaultRedirectType = "301";
  }

  return {
    rateLimitWindowSec,
    rateLimitMax,
    allowedOrigins,
    allowNoOrigin: isTrue(env.ALLOW_NO_ORIGIN, true),
    stripTrailingSlash: isTrue(env.STRIP_TRAILING_SLASH, true),
    maxUrlLength: parsePositiveInt(env.MAX_URL_LENGTH, 2048, 1),
    defaultTtlSeconds: Number.isFinite(Number(env.DEFAULT_TTL_SECONDS)) && Number(env.DEFAULT_TTL_SECONDS) >= 0 ? Number(env.DEFAULT_TTL_SECONDS) : 0,
    trustMode: parseTrustMode(env.TRUST_MODE),
    allowUrlDomains,
    denyUrlDomains,
    urlPrecheckUrl: env.URL_PRECHECK_URL,
    urlPrecheckTimeoutMs,
    urlPrecheckFailOpen: isTrue(env.URL_PRECHECK_FAIL_OPEN),
    defaultRedirectType,
    statsRetentionDays,
  };
}
