import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BlackBoxStore } from "../src/server/store";
import { createControlledShoppingRun } from "../src/server/firewall/shopping";
import { executeShoppingRun } from "../src/server/shopping/runtime";
import {
  sandboxAvailability,
  PaymentError,
} from "../src/server/payments/config";
import { sandboxGateway, paymentView } from "../src/server/payments/gateway";
async function main() {
  loadEnvConfig(process.cwd());
  const availability = sandboxAvailability(),
    create = process.argv.includes("--create-order"),
    verify = process.argv.includes("--verify"),
    newMandate = process.argv.includes("--new-mandate");
  if (!availability.available || (!create && !verify)) {
    console.log(
      JSON.stringify({
        mode: "paypal_sandbox_configuration_only",
        ...availability,
        financial_calls: false,
      }),
    );
    if ((create || verify) && !availability.available) process.exitCode = 2;
    return;
  }
  if (process.env.NODE_ENV === "test")
    throw new Error("Real integration smoke is unavailable in test mode");
  const store = new BlackBoxStore(resolve("data/phase4-sandbox.sqlite")),
    latestPath = resolve("data/phase4-latest-sandbox.json");
  const originalFetch = globalThis.fetch;
  let orderPosts = 0,
    capturePosts = 0,
    oauthPosts = 0,
    lookups = 0,
    blocked = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url,
      ),
      method = init?.method ?? "GET";
    const ollama =
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      ["/api/chat", "/api/show", "/api/tags"].includes(url.pathname);
    const oauth =
      url.origin === "https://api-m.sandbox.paypal.com" &&
      url.pathname === "/v1/oauth2/token" &&
      method === "POST";
    const order =
      url.origin === "https://api-m.sandbox.paypal.com" &&
      url.pathname === "/v2/checkout/orders" &&
      method === "POST" &&
      create &&
      !verify;
    const lookup =
      url.origin === "https://api-m.sandbox.paypal.com" &&
      /^\/v2\/checkout\/orders\/[A-Z0-9]{10,32}$/.test(url.pathname) &&
      method === "GET" &&
      verify;
    if (!ollama && !oauth && !order && !lookup) {
      blocked++;
      if (url.pathname.endsWith("/capture")) capturePosts++;
      throw new Error(
        "Unexpected financial/network operation blocked by integration smoke",
      );
    }
    if (oauth) oauthPosts++;
    if (order) orderPosts++;
    if (lookup) lookups++;
    return originalFetch(input, init);
  };
  try {
    let latest: { run_id: string; proposal_id: string } | null = existsSync(
      latestPath,
    )
      ? JSON.parse(readFileSync(latestPath, "utf8"))
      : null;
    if (
      latest &&
      newMandate &&
      ["unknown_reconciling", "order_creating", "capture_pending"].includes(
        paymentView(store, latest.proposal_id).state,
      )
    )
      throw new PaymentError("OPERATION_PENDING");
    if (!latest || newMandate) {
      if (!create || verify)
        throw new Error("An existing original proposal is required");
      const run = createControlledShoppingRun(store, {
        persona: "consumer",
        catalog_mode: "offline",
        objective:
          "Find everyday running shoes under $150 from the seeded sports seller for an explicitly labeled PayPal sandbox simulation with no fulfillment.",
        budget_minor: 15000,
        currency: "USD",
        quantity: 1,
        preferences: ["Everyday comfort"],
        merchant_ids: ["seed_sports"],
      });
      const saved = await executeShoppingRun(store, run.run_id),
        events = store.detail(run.run_id).events;
      const eligible = saved.firewall?.proposals.find((p) =>
        saved.firewall?.decisions.some(
          (d) => d.proposal_id === p.proposal_id && d.outcome === "ALLOW",
        ),
      );
      console.log(
        JSON.stringify({
          mode: "actual_qwen_seeded_catalog",
          run_id: run.run_id,
          status: saved.status,
          actual_model_completions: events.filter(
            (e) =>
              e.event_type === "model_completed" &&
              e.payload.outcome === "completed",
          ).length,
          decision_outcomes: saved.firewall?.decisions.map((d) => d.outcome),
          synthetic_events: events.filter(
            (e) => e.provenance.mode === "synthetic",
          ).length,
        }),
      );
      if (!eligible) {
        process.exitCode = 1;
        return;
      }
      latest = { run_id: run.run_id, proposal_id: eligible.proposal_id };
      writeFileSync(latestPath, JSON.stringify(latest, null, 2));
    } else if (!verify) {
      console.log(
        JSON.stringify({
          mode: "existing_attempt_preserved",
          ...latest,
          payment: paymentView(store, latest.proposal_id),
          new_order_call: false,
        }),
      );
      return;
    }
    const result = await sandboxGateway(store).operate({
      proposal_id: latest.proposal_id,
      operation: verify ? "verify" : "create",
    });
    console.log(
      JSON.stringify({
        mode: "real_paypal_sandbox",
        ...latest,
        state: result.state,
        provider_status: result.provider_status,
        order_id: result.order_id,
        capture_id: result.capture_id,
        capture_status: result.capture_status,
        error_code: result.error_code,
        provider_error_code: result.provider_error_code,
        approval_url: result.approval_url,
        payment_captured: result.payment_captured,
        oauth_posts: oauthPosts,
        order_posts: orderPosts,
        capture_posts: capturePosts,
        read_only_lookups: lookups,
        blocked_network_operations: blocked,
        retailer_fulfillment: false,
      }),
    );
    if (
      !result.order_id ||
      ["failed", "unknown_reconciling"].includes(result.state)
    )
      process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
}
void main().catch((error) => {
  console.log(
    JSON.stringify({
      mode: "real_paypal_sandbox",
      status: "failed",
      error_code:
        error instanceof PaymentError
          ? error.code
          : "LOCAL_SETUP_OR_STORAGE_FAILURE",
      provider_error_code:
        error instanceof PaymentError ? error.providerCode : null,
      payment_captured: false,
    }),
  );
  process.exitCode = 1;
});
