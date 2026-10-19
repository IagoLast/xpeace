import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
  webServer: {
    // Test this checkout's build, never an unrelated or stale local dev server.
    command: "npm run build && npm run start -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    env: { APP_URL: "http://127.0.0.1:3100" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
