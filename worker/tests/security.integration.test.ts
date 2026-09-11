import { describe, expect, it } from "vitest";
import type { WorkerEnv } from "../src/env";
import worker from "../src/index";

function createFakeKV() {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  };
}

function baseEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    LINKS: createFakeKV(),
    API_KEY: "legacy-secret",
    BASE_URL: "https://go.example.com",
    RATE_LIMIT_MAX: "100",
    ...overrides,
  } as WorkerEnv;
}

function shortenRequest(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return new Request("https://go.example.com/api/shorten", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": "legacy-secret",
      ...headers,
    },
    body: JSON.stringify({ url: "https://example.com/path", ...body }),
  });
}

describe("request boundary security", () => {
  it("accepts authenticated non-browser clients by default", async () => {
    const response = await worker.fetch(shortenRequest(), baseEnv());
    expect(response.status).toBe(200);
  });

  it("rejects an unlisted cross-origin browser request", async () => {
    const response = await worker.fetch(
      shortenRequest({ Origin: "https://unlisted.example" }),
      baseEnv(),
    );
    expect(response.status).toBe(403);
  });

  it("allows the service's own web UI", async () => {
    const response = await worker.fetch(
      shortenRequest({ Origin: "https://go.example.com" }),
      baseEnv(),
    );
    expect(response.status).toBe(200);
  });

  it("answers CORS preflight only for an allowed browser origin", async () => {
    const env = baseEnv({ ALLOWED_ORIGINS: "https://publisher.example" });
    const allowed = await worker.fetch(
      new Request("https://go.example.com/api/shorten", {
        method: "OPTIONS",
        headers: {
          Origin: "https://publisher.example",
          "Access-Control-Request-Method": "POST",
        },
      }),
      env,
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://publisher.example");

    const denied = await worker.fetch(
      new Request("https://go.example.com/api/shorten", {
        method: "OPTIONS",
        headers: { Origin: "https://unlisted.example" },
      }),
      env,
    );
    expect(denied.status).toBe(403);
  });

  it("fails closed when API_KEYS_JSON is malformed", async () => {
    const response = await worker.fetch(
      shortenRequest(),
      baseEnv({ API_KEYS_JSON: "not-json" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("private links", () => {
  it("restricts token-bound links to their creator or an admin", async () => {
    const env = baseEnv({
      API_KEY: "",
      API_KEYS_JSON: JSON.stringify([
        { id: "writer-1", role: "writer", secret: "writer-one" },
        { id: "writer-2", role: "writer", secret: "writer-two" },
        { id: "admin", role: "admin", secret: "admin-secret" },
      ]),
    });

    const create = await worker.fetch(
      shortenRequest(
        { "X-API-Key": "writer-one", "X-API-Key-Id": "writer-1" },
        { customSlug: "private-demo", private: true, privateTokenRequired: true },
      ),
      env,
    );
    expect(create.status).toBe(200);

    const otherWriter = await worker.fetch(
      new Request("https://go.example.com/private-demo", {
        headers: { "X-API-Key": "writer-two", "X-API-Key-Id": "writer-2" },
      }),
      env,
    );
    expect(otherWriter.status).toBe(403);

    const creator = await worker.fetch(
      new Request("https://go.example.com/private-demo", {
        headers: { "X-API-Key": "writer-one", "X-API-Key-Id": "writer-1" },
      }),
      env,
    );
    expect(creator.status).toBe(302);

    const admin = await worker.fetch(
      new Request("https://go.example.com/private-demo", {
        headers: { "X-API-Key": "admin-secret", "X-API-Key-Id": "admin" },
      }),
      env,
    );
    expect(admin.status).toBe(302);
  });
});

describe("multi-key ownership", () => {
  it("does not let a writer modify another writer's link", async () => {
    const env = baseEnv({
      API_KEY: "",
      API_KEYS_JSON: JSON.stringify([
        { id: "writer-1", role: "writer", secret: "writer-one" },
        { id: "writer-2", role: "writer", secret: "writer-two" },
      ]),
    });

    const create = await worker.fetch(
      shortenRequest(
        { "X-API-Key": "writer-one", "X-API-Key-Id": "writer-1" },
        { customSlug: "owned-link" },
      ),
      env,
    );
    expect(create.status).toBe(200);

    const update = await worker.fetch(
      new Request("https://go.example.com/api/link/owned-link", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "X-API-Key": "writer-two",
          "X-API-Key-Id": "writer-2",
        },
        body: JSON.stringify({ disabled: true }),
      }),
      env,
    );
    expect(update.status).toBe(403);

    const overwrite = await worker.fetch(
      shortenRequest(
        { "X-API-Key": "writer-two", "X-API-Key-Id": "writer-2" },
        { url: "https://example.net/replacement", customSlug: "owned-link", overwrite: true },
      ),
      env,
    );
    expect(overwrite.status).toBe(403);
  });
});

describe("fallback URL validation", () => {
  it("rejects local and non-http fallback destinations", async () => {
    const local = await worker.fetch(
      shortenRequest({}, { customSlug: "local-fallback", fallbackUrl: "http://127.0.0.1/admin" }),
      baseEnv(),
    );
    expect(local.status).toBe(400);

    const script = await worker.fetch(
      shortenRequest({}, { customSlug: "script-fallback", fallbackUrl: "javascript:alert(1)" }),
      baseEnv(),
    );
    expect(script.status).toBe(400);
  });
});

describe("bounded operational queries", () => {
  it("rejects stats ranges that would create excessive KV reads", async () => {
    const response = await worker.fetch(
      new Request("https://go.example.com/api/stats?window=minute&since=2020-01-01T00:00:00.000Z", {
        headers: { "X-API-Key": "legacy-secret" },
      }),
      baseEnv(),
    );
    expect(response.status).toBe(400);
  });
});
