import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { WorkerEnv } from "../src/env";
import { sha256Base32 } from "../src/slug/generator";

function fixture() {
  const records = new Map<string, string>();
  const put = vi.fn(async (key: string, value: string) => { records.set(key, value); });
  const point = vi.fn();
  const env = { ANALYTICS: { writeDataPoint: point }, BASE_URL: "https://go.example.com", API_KEY: "secret", ALLOW_NO_ORIGIN: "true",
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    LINKS: { get: async (key: string) => records.get(key) ?? null, put },
  } as unknown as WorkerEnv;
  const call = (path: string, body: unknown, method = "POST") => worker.fetch(new Request(`https://alias.example.com${path}`, {
    method, headers: { "Content-Type": "application/json", "X-API-Key": "secret" }, body: JSON.stringify(body),
  }), env);
  return { records, put, point, env, call };
}

describe("management matches redirect policy", () => {
  it.each(["https://go.example.com/loop", "https://alias.example.com/loop"])("rejects target/fallback on either service origin: %s", async url => {
    const f = fixture();
    f.records.set("demo", JSON.stringify({ slug: "demo", url: "https://example.com/", createdAt: 1, updatedAt: 1 }));
    for (const body of [{ url }, { url: "https://example.com/", fallbackUrl: url }]) {
      expect((await f.call("/api/shorten", body)).status).toBe(400);
    }
    for (const body of [{ url, overwrite: true }, { fallbackUrl: url }]) {
      expect((await f.call("/api/link/demo", body, "PUT")).status).toBe(400);
    }
    expect(f.put).not.toHaveBeenCalled();
  });

  it.each([
    { url: "https://go.example.com/old" },
    { url: "https://alias.example.com/old" },
    { fallbackUrl: "https://go.example.com/old" },
    { fallbackUrl: "https://alias.example.com/old" },
    { url: "http://127.0.0.1/" },
    { fallbackUrl: "javascript:alert(1)" },
  ])("rejects unsafe inherited destinations on metadata updates: %j", async unsafe => {
    const f = fixture();
    const stored = JSON.stringify({ slug: "demo", url: "https://example.com/", expiresAt: 1, createdAt: 1, updatedAt: 1, ...unsafe });
    f.records.set("demo", stored);
    for (const body of [{ ttl: 3600 }, { expiresAt: new Date(Date.now() + 3600000).toISOString() }, { private: true }]) {
      expect((await f.call("/api/link/demo", body, "PUT")).status).toBe(400);
    }
    expect(f.put).not.toHaveBeenCalled();
    expect(f.records.get("demo")).toBe(stored);
    const repair = { url: "https://example.com/repaired#fragment", fallbackUrl: "", overwrite: true, ttl: 3600 };
    expect((await f.call("/api/link/demo", repair, "PUT")).status).toBe(200);
  });

  it.each(["custom", "deterministic", "collision"])("requires explicit renewal of expired %s links", async mode => {
    const f = fixture();
    const url = "https://example.com/";
    const hash = await sha256Base32(url);
    const slug = mode === "custom" ? "demo" : hash.slice(0, mode === "collision" ? 10 : 6);
    if (mode === "collision") f.records.set(hash.slice(0, 6), JSON.stringify({ slug: hash.slice(0, 6), url: "https://other.example/", createdAt: 1, updatedAt: 1 }));
    const record = { slug, url, expiresAt: 1, createdAt: 1, updatedAt: 1, private: true, accessCount: 7 };
    f.records.set(slug, JSON.stringify(record));
    const response = await f.call("/api/shorten", { url, ttl: 3600, ...(mode === "custom" ? { customSlug: slug } : {}) });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain(`PUT /api/link/${slug}`);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.point).toHaveBeenCalledTimes(1);
    expect(f.point).toHaveBeenCalledWith({ indexes: ["api_conflict"], blobs: ["api_conflict", ""], doubles: [1] });
    expect(JSON.parse(f.records.get(slug)!)).toEqual(record);
    expect((await f.call(`/api/link/${slug}`, { ttl: 3600 }, "PUT")).status).toBe(200);
    expect(JSON.parse(f.records.get(slug)!)).toMatchObject({ private: true, createdAt: 1, accessCount: 7 });
    expect(JSON.parse(f.records.get(slug)!).expiresAt).toBeGreaterThan(Date.now());
    expect((await worker.fetch(new Request(`https://alias.example.com/${slug}`, { headers: { "X-API-Key": "secret" } }), f.env)).status).toBe(302);
  });
});
