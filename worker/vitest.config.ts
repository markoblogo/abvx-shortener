import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          API_KEY: "test-secret",
          BASE_URL: "https://go.example.com",
          ALLOW_NO_ORIGIN: "true",
          RATE_LIMIT_MAX: "100",
        },
      },
    }),
  ],
});
