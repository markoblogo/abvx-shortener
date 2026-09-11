import { describe, expect, it } from "vitest";
import { authenticateRequest, sha256Hex } from "../src/auth/index";
import type { WorkerEnv } from "../src/env";

function envWithKeys(apiKeysJson: string): WorkerEnv {
  return {
    LINKS: {} as KVNamespace,
    API_KEY: "",
    BASE_URL: "https://go.example.com",
    API_KEYS_JSON: apiKeysJson,
  };
}

describe("API key hashing", () => {
  it("accepts a SHA-256 key hash", async () => {
    const digest = await sha256Hex("correct-horse-battery-staple");
    const env = envWithKeys(
      JSON.stringify([{ id: "writer", role: "writer", secret_hash: `sha256:${digest}` }]),
    );
    const request = new Request("https://go.example.com/api/links", {
      headers: { "X-API-Key": "correct-horse-battery-staple", "X-API-Key-Id": "writer" },
    });

    await expect(authenticateRequest(request, env)).resolves.toMatchObject({ id: "writer", role: "writer" });
  });

  it("does not accept the former 32-bit hash format", async () => {
    const env = envWithKeys(
      JSON.stringify([{ id: "writer", role: "writer", secret_hash: "deadbeef" }]),
    );
    const request = new Request("https://go.example.com/api/links", {
      headers: { "X-API-Key": "anything", "X-API-Key-Id": "writer" },
    });

    await expect(authenticateRequest(request, env)).resolves.toBeNull();
  });
});
