import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { WorkerEnv } from "../src/env";
import { getLink } from "../src/storage/links";

function fixture(record: unknown = { slug: "demo", url: "https://example.com/path#anchor", createdAt: 1, updatedAt: 1 }) {
  const records = new Map([["demo", typeof record === "string" ? record : JSON.stringify(record)]]);
  const get = vi.fn(async (key: string) => records.get(key) ?? null);
  // Any write on the read path represents a regression; real KV also rejects hot-key writes.
  const put = vi.fn(async () => { throw new Error("KV write limit exceeded"); });
  const del = vi.fn(async () => { throw new Error("Unexpected delete"); });
  const point = vi.fn();
  const env = { LINKS: { get, put, delete: del }, API_KEY: "secret", BASE_URL: "https://go.example.com", ANALYTICS: { writeDataPoint: point } } as unknown as WorkerEnv;
  return { records, get, put, del, point, env };
}
const record = { slug: "demo", url: "https://example.com/path#anchor", createdAt: 1, updatedAt: 1 };
afterEach(() => vi.restoreAllMocks());

describe("read-only redirects and event analytics", () => {
  it("handles a burst without rewriting link data or losing events", async () => {
    const f = fixture();
    const before = f.records.get("demo");
    const responses = await Promise.all(Array.from({ length: 20 }, () => worker.fetch(new Request("https://go.example.com/demo"), f.env)));
    expect(responses.every(r => r.status === 302 && r.headers.get("location") === record.url)).toBe(true);
    expect(f.get).toHaveBeenCalledTimes(20);
    expect(f.put).not.toHaveBeenCalled();
    expect(f.del).not.toHaveBeenCalled();
    expect(f.records.get("demo")).toBe(before);
    expect(f.point).toHaveBeenCalledTimes(20);
    expect(f.point).toHaveBeenCalledWith({ indexes: ["redirect_hit"], blobs: ["redirect_hit", "demo"], doubles: [1] });
  });

  it("does not count HEAD probes or expose private cached redirects", async () => {
    const f = fixture({ ...record, private: true });
    const response = await worker.fetch(new Request("https://go.example.com/demo", { method: "HEAD", headers: { "X-API-Key": "secret" } }), f.env);
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.point).not.toHaveBeenCalled();
    const denied = await worker.fetch(new Request("https://go.example.com/demo"), f.env);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("location")).toBeNull();
  });

  it("keeps expired records and uses disabled fallbacks", async () => {
    for (const state of [{ expiresAt: 2 }, { disabled: true }]) {
      const f = fixture({ ...record, ...state, fallbackUrl: "https://example.com/fallback" });
      const response = await worker.fetch(new Request("https://go.example.com/demo"), f.env);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://example.com/fallback");
      expect(f.del).not.toHaveBeenCalled();
      expect(f.put).not.toHaveBeenCalled();
    }
    const f = fixture({ ...record, expiresAt: 2 });
    expect(await getLink(f.env.LINKS, "demo")).toBeNull();
    expect(f.del).not.toHaveBeenCalled();
  });

  it("authorizes private expired and disabled links before revealing fallback", async () => {
    for (const state of [{ expiresAt: 2 }, { disabled: true }]) {
      const f = fixture({ ...record, ...state, private: true, fallbackUrl: "https://example.com/private-fallback" });
      const response = await worker.fetch(new Request("https://go.example.com/demo"), f.env);
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it.each(["javascript:alert(1)", "http://127.0.0.1/", "http://[::1]/", "http://[fd00::1]/", "https://user:pass@example.com/", "https://go.example.com/demo"])("rejects unsafe stored target %s", async url => {
    const f = fixture(url);
    const response = await worker.fetch(new Request("https://go.example.com/demo"), f.env);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("rejects unsafe fallback destinations", async () => {
    const f = fixture({ ...record, disabled: true, fallbackUrl: "javascript:alert(1)" });
    const response = await worker.fetch(new Request("https://go.example.com/demo"), f.env);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects invalid/system paths before reading KV", async () => {
    const f = fixture();
    for (const path of ["stats%3Aday", "favicon.ico", "nested/path", "%ZZ"]) {
      expect((await worker.fetch(new Request(`https://go.example.com/${path}`), f.env)).status).toBe(404);
    }
    expect(f.get).not.toHaveBeenCalled();
    expect(f.put).not.toHaveBeenCalled();
  });

  it("returns a controlled error when an asynchronous KV read fails", async () => {
    const f = fixture();
    f.get.mockRejectedValue(new Error("Secret backend details"));
    const response = await worker.fetch(new Request("https://go.example.com/demo"), f.env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "internal_error", message: "Internal server error" });
  });

  it("logs metrics without a provisioned Analytics Engine binding", async () => {
    const f = fixture();
    delete f.env.ANALYTICS;
    const log = vi.spyOn(console, "log");
    expect((await worker.fetch(new Request("https://go.example.com/demo"), f.env)).status).toBe(302);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"metric":"redirect_hit"'));
    expect(f.put).not.toHaveBeenCalled();
  });

  it("redirects even when telemetry fails", async () => {
    const f = fixture();
    f.point.mockImplementation(() => { throw new Error("Unavailable"); });
    expect((await worker.fetch(new Request("https://go.example.com/demo"), f.env)).status).toBe(302);
  });

  it("labels legacy counters as incomplete and current counts as unavailable", async () => {
    const f = fixture();
    const response = await worker.fetch(new Request("https://go.example.com/api/stats?window=hour", { headers: { "X-API-Key": "secret" } }), f.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "legacy-kv", complete: false, collection: "stopped", currentTotals: null });
    expect(f.put).not.toHaveBeenCalled();
  });

  it("rejects a range whose aligned buckets exceed the read budget", async () => {
    const f = fixture();
    const response = await worker.fetch(new Request("https://go.example.com/api/stats?window=minute&since=2026-01-01T00:00:59.000Z&until=2026-01-01T01:30:01.000Z", { headers: { "X-API-Key": "secret" } }), f.env);
    expect(response.status).toBe(400);
    expect(f.get).not.toHaveBeenCalled();
  });
});
