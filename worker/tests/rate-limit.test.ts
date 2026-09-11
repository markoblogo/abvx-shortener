import { describe, expect, it } from "vitest";
import type { WorkerEnv } from "../src/env";
import { rateLimitOk } from "../src/rateLimit/index";

describe("native rate limiting", () => {
  it("limits by both client IP and the API-key secret, ignoring spoofed key IDs", async () => {
    const seen: string[] = [];
    const env = {
      RATE_LIMITER: {
        async limit({ key }: { key: string }) {
          seen.push(key);
          return { success: true };
        },
      },
    } as unknown as WorkerEnv;
    const request = new Request("https://go.example.com/api/shorten", {
      headers: {
        "CF-Connecting-IP": "203.0.113.8",
        "X-API-Key": "real-secret",
        "X-API-Key-Id": "attacker-controlled",
      },
    });

    await expect(rateLimitOk(env, request, 60, 30)).resolves.toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen).toContain("shorten:ip:203.0.113.8");
    expect(seen.some((key) => key.includes("attacker-controlled"))).toBe(false);
    expect(seen.some((key) => key.startsWith("shorten:key:") && key.length > 20)).toBe(true);
  });

  it("rejects when either native limiter denies the request", async () => {
    let call = 0;
    const env = {
      RATE_LIMITER: {
        async limit() {
          call += 1;
          return { success: call !== 2 };
        },
      },
    } as unknown as WorkerEnv;

    await expect(
      rateLimitOk(
        env,
        new Request("https://go.example.com/api/shorten", { headers: { "X-API-Key": "secret" } }),
        60,
        30,
      ),
    ).resolves.toBe(false);
  });
});
