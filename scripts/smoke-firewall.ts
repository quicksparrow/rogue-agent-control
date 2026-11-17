import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { BlackBoxStore } from "../src/server/store";
import { createFirewallScenario } from "../src/server/firewall/scenarios";
import { createControlledShoppingRun } from "../src/server/firewall/shopping";
import { executeShoppingRun } from "../src/server/shopping/runtime";

async function main() {
  loadEnvConfig(process.cwd());
  const store = new BlackBoxStore(resolve("data/phase3-smoke.sqlite"));
  const originalFetch = globalThis.fetch;
  let prohibitedRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    const permitted =
      (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        ["/api/chat", "/api/show", "/api/tags"].includes(url.pathname)) ||
      (url.origin === "https://api.trychannel3.com" &&
        url.pathname === "/v1/search");
    if (!permitted) {
      prohibitedRequests++;
      throw new Error("Unexpected outbound operation prevented by smoke test");
    }
    return originalFetch(input, init);
  };
  try {
    const live = process.argv.includes("--live-agent"),
      agent = process.argv.includes("--agent");
    if (live || agent) {
      for (const persona of live
        ? (["consumer"] as const)
        : (["consumer", "business"] as const)) {
        const business = persona === "business";
        const run = createControlledShoppingRun(store, {
          persona,
          catalog_mode: live ? "channel3" : "offline",
          objective: business
            ? "Find 10 wireless mice for our office under $250 total."
            : "Find everyday running shoes under $120.",
          budget_minor: business ? 25000 : 12000,
          currency: "USD",
          quantity: business ? 10 : 1,
          preferences: [business ? "Wireless office use" : "Everyday comfort"],
          merchant_ids: live
            ? [
                "amazon.com",
                "nike.com",
                "walmart.com",
                "zappos.com",
                "dickssportinggoods.com",
                "rackroomshoes.com",
                "kohls.com",
                "nordstrom.com",
                "finishline.com",
                "jdsports.com",
              ]
            : [business ? "seed_office" : "seed_sports"],
        });
        const saved = await executeShoppingRun(store, run.run_id),
          events = store.detail(run.run_id).events;
        console.log(
          JSON.stringify({
            mode: live
              ? "actual_model_live_catalog"
              : "actual_model_seeded_catalog",
            persona,
            run_id: run.run_id,
            status: saved.status,
            error_code: saved.error_code,
            actual_model_completions: events.filter(
              (e) =>
                e.event_type === "model_completed" &&
                e.payload.outcome === "completed",
            ).length,
            recommendation_count: saved.recommendations.length,
            quantities: live
              ? undefined
              : saved.recommendations.map((r) => r.quantity),
            decisions: saved.firewall?.decisions.map((d) => ({
              outcome: d.outcome,
              reason_codes: d.reason_codes,
              decision_id: d.decision_id,
            })),
            payment_executed: false,
            prohibited_outbound_requests: prohibitedRequests,
          }),
        );
        if (
          saved.status !== "completed" ||
          !saved.recommendations.length ||
          saved.firewall?.decisions.length !== saved.recommendations.length ||
          (live &&
            saved.firewall.decisions.some(
              (d) =>
                d.outcome !== "DENY" ||
                !d.reason_codes.includes("MERCHANT_UNVERIFIED"),
            ))
        )
          process.exitCode = 1;
      }
    } else {
      for (const [scenario, expected] of [
        ["allowed", "ALLOW"],
        ["over_budget", "DENY"],
        ["quantity_mismatch", "REVIEW"],
        ["unknown_merchant", "DENY"],
        ["approval_required", "REVIEW"],
      ] as const) {
        const result = createFirewallScenario(store, scenario);
        console.log(
          JSON.stringify({
            mode: "controlled_synthetic_proposal_real_policy",
            scenario,
            run_id: result.run.run_id,
            expected,
            outcome: result.decision.outcome,
            reason_codes: result.decision.reason_codes,
            payment_executed: false,
            prohibited_outbound_requests: prohibitedRequests,
          }),
        );
        if (result.decision.outcome !== expected) process.exitCode = 1;
      }
    }
    if (prohibitedRequests) process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    store.close();
  }
}
void main().catch(() => {
  console.log(
    JSON.stringify({
      firewall_smoke: "failed",
      error: "local_setup_or_storage_failure",
      payment_executed: false,
    }),
  );
  process.exitCode = 1;
});
