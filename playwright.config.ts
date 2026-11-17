import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: process.env.RAC_E2E_PRODUCTION === "1"
      ? "npm start -- --port 3101"
      : "npm run dev -- --port 3101",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      DATABASE_PATH: resolve(`data/e2e-${process.pid}.sqlite`),
      NEXT_TELEMETRY_DISABLED: "1",
      // Deterministic browser failure paths; real-model checks run separately via test:smoke.
      OLLAMA_BASE_URL: "http://127.0.0.1:1",
      CHANNEL3_API_KEY: "",
      PAYPAL_MODE: "disabled",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_SANDBOX_MERCHANT_ID: "",
      PAYPAL_SANDBOX_DEMO_MERCHANT_IDS: "",
      ROGUE_OWNER_ID: "local_buyer",
      ROGUE_AGENT_ID: "shopping_qwen3",
    },
  },
});
