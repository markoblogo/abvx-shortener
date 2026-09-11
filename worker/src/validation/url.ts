import type { WorkerEnv } from "../env";
import { getConfig } from "../env";

export interface CanonicalizeOptions {
  stripTrailingSlash?: boolean;
  maxLength?: number;
  trustConfig?: {
    allowUrlDomains: string[];
    denyUrlDomains: string[];
  };
}

interface PrecheckPayload {
  url: string;
  hostname: string;
}

function isLocalOrPrivateHost(host: string): boolean {
  if (!host) return true;
  const lowered = host.toLowerCase();

  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered === "::1" || lowered === "0.0.0.0") {
    return true;
  }

  if (/^127\./.test(lowered) || /^10\./.test(lowered) || /^192\.168\./.test(lowered) || /^169\.254\./.test(lowered)) {
    return true;
  }

  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lowered)) {
    return true;
  }

  if (lowered.startsWith("fc") || lowered.startsWith("fd") || lowered.startsWith("fe80")) {
    return true;
  }

  return false;
}

function normalizeDomainList(raw: string[]): string[] {
  return raw
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/^\./, ""));
}

function hasAllowedDomain(host: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const target = host.toLowerCase();
  return allowed.some((entry) => target === entry || target.endsWith(`.${entry}`));
}

function hasDeniedDomain(host: string, denied: string[]): boolean {
  if (!denied.length) return false;
  const target = host.toLowerCase();
  return denied.some((entry) => target === entry || target.endsWith(`.${entry}`));
}

async function runSafetyPrecheck(env: WorkerEnv, rawUrl: string, hostname: string): Promise<void> {
  if (!env.URL_PRECHECK_URL) {
    return;
  }

  const timeout = Number.isFinite(Number(env.URL_PRECHECK_TIMEOUT_MS)) ? Number(env.URL_PRECHECK_TIMEOUT_MS) : 1500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(env.URL_PRECHECK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: rawUrl, hostname }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (getConfig(env).urlPrecheckFailOpen) {
        return;
      }
      throw new Error("URL precheck rejected by external policy");
    }

    const payload = (await response.json().catch(() => ({}))) as Partial<PrecheckPayload> & { allowed?: boolean; reason?: string };
    if (payload.allowed === false) {
      throw new Error(payload.reason || "URL precheck rejected");
    }
  } finally {
    clearTimeout(timer);
  }
}

export function canonicalizeUrl(input: string, env: WorkerEnv, options: CanonicalizeOptions = {}): string {
  const cfg = getConfig(env);
  const raw = input.trim();
  if (!raw) {
    throw new Error("Missing URL");
  }

  const maxLen = options.maxLength ?? cfg.maxUrlLength;
  if (raw.length > maxLen) {
    throw new Error("URL is too long");
  }

  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
    parsed.port = "";
  }

  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not allowed");
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();

  const host = parsed.hostname;

  if (!hasAllowedDomain(host, normalizeDomainList(options.trustConfig?.allowUrlDomains ?? cfg.allowUrlDomains))) {
    throw new Error("URL domain is not allowed");
  }

  if (hasDeniedDomain(host, normalizeDomainList(options.trustConfig?.denyUrlDomains ?? cfg.denyUrlDomains))) {
    throw new Error("URL domain is denied");
  }

  if (isLocalOrPrivateHost(host)) {
    throw new Error("Local/private hosts are not allowed");
  }

  if (options.stripTrailingSlash !== false) {
    const path = parsed.pathname;
    if (path.length > 1 && path.endsWith("/")) {
      parsed.pathname = path.replace(/\/+$/, "");
    }
  }

  return parsed.toString();
}

export async function canonicalizeUrlWithPrecheck(raw: string, env: WorkerEnv, options: CanonicalizeOptions = {}): Promise<string> {
  const url = canonicalizeUrl(raw, env, options);
  const parsed = new URL(url);
  await runSafetyPrecheck(env, url, parsed.hostname);
  return url;
}

export function isAllowedScheme(input: string): boolean {
  const lowered = input.toLowerCase();
  return lowered.startsWith("http:") || lowered.startsWith("https:");
}
