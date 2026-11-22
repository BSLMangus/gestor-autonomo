import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4273",
    headless: true,
    viewport: { width: 412, height: 915 },
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    acceptDownloads: true,
  },
  webServer: {
    command: "npx vite preview --host 127.0.0.1 --port 4273 --strictPort",
    url: "http://127.0.0.1:4273",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
