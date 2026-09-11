import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("Cloudflare runtime", () => {
  it("persists and redirects a link through the real KV binding", async () => {
    const createContext = createExecutionContext();
    const create = await worker.fetch(
      new Request("https://go.example.com/api/shorten", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-API-Key": "test-secret",
        },
        body: JSON.stringify({ url: "https://example.com/runtime", customSlug: "runtime-test" }),
      }),
      env,
      createContext,
    );
    await waitOnExecutionContext(createContext);
    expect(create.status).toBe(200);

    const redirectContext = createExecutionContext();
    const redirect = await worker.fetch(
      new Request("https://go.example.com/runtime-test"),
      env,
      redirectContext,
    );
    await waitOnExecutionContext(redirectContext);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/runtime");
  });
});
