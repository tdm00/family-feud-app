import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "pnpm --filter @feud/web build && rm -f data/e2e.sqlite data/e2e.sqlite-wal data/e2e.sqlite-shm && pnpm --filter @feud/server exec tsx src/index.ts",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: "4173",
      HOST_PASSWORD: "test-host",
      ROOM_CODE: "TEST",
      SESSION_SECRET: "test-secret-test-secret",
      DATABASE_PATH: "data/e2e.sqlite",
      NODE_ENV: "test",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
