import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { BlackBoxStore } from "../src/server/store";
import {
  createShoppingRun,
  executeShoppingRun,
} from "../src/server/shopping/runtime";
import { Channel3Catalog } from "../src/server/shopping/catalog";
import { safeFailure } from "../src/server/shopping/errors";
import type { ShoppingInput } from "../src/lib/shopping-contracts";

async function main() {
  loadEnvConfig(process.cwd());
  const store = new BlackBoxStore(resolve("data/phase2-smoke.sqlite"));
  try {
    if (process.argv.includes("--live")) {
      try {
        await new Channel3Catalog().search(
          { query: "everyday running shoes", limit: 2 },
          "USD",
        );
        console.log(
          JSON.stringify({ channel3: "connected", search: "succeeded" }),
        );
      } catch (error) {
        const failure = safeFailure(error);
        console.log(
          JSON.stringify({ channel3: "failed", error_code: failure.code }),
        );
        process.exitCode = 1;
      }
    } else if (process.argv.includes("--live-agent")) {
      const run = createShoppingRun(store, {
        persona: "consumer",
        catalog_mode: "channel3",
        objective: "Find everyday running shoes under $120.",
        budget_minor: 12000,
        currency: "USD",
        quantity: 1,
        preferences: ["Everyday comfort"],
        merchant_ids: [
          "nike.com",
          "amazon.com",
          "zappos.com",
          "walmart.com",
          "dickssportinggoods.com",
          "rackroomshoes.com",
          "kohls.com",
          "nordstrom.com",
          "finishline.com",
          "jdsports.com",
        ],
      });
      const result = await executeShoppingRun(store, run.run_id);
      const detail = store.detail(run.run_id);
      console.log(
        JSON.stringify({
          live_agent_status: result.status,
          error_code: result.error_code,
          run_id: run.run_id,
          observed_live_products: result.products.length,
          actual_model_completions: detail.events.filter(
            (e) =>
              e.event_type === "model_completed" &&
              e.payload.outcome === "completed",
          ).length,
          recommendation_count: result.recommendations.length,
          synthetic_events: detail.events.filter(
            (e) => e.provenance.mode === "synthetic",
          ).length,
        }),
      );
      if (result.status !== "completed") process.exitCode = 1;
    } else {
      for (const persona of ["consumer", "business"] as const) {
        const input: ShoppingInput = {
          persona,
          catalog_mode: "offline",
          objective:
            persona === "consumer"
              ? "Find everyday running shoes under $120."
              : "Find 10 wireless mice for our office with a total budget of $250.",
          budget_minor: persona === "consumer" ? 12000 : 25000,
          currency: "USD",
          quantity: persona === "consumer" ? 1 : 10,
          preferences: [
            persona === "consumer" ? "Everyday comfort" : "Wireless office use",
          ],
          merchant_ids: [
            persona === "consumer" ? "seed_sports" : "seed_office",
          ],
        };
        const run = createShoppingRun(store, input);
        const result = await executeShoppingRun(store, run.run_id);
        const events = store.detail(run.run_id).events;
        console.log(
          JSON.stringify({
            persona,
            run_id: run.run_id,
            status: result.status,
            error_code: result.error_code,
            actual_model_completions: events.filter(
              (e) =>
                e.event_type === "model_completed" &&
                e.payload.outcome === "completed",
            ).length,
            recommendations: result.recommendations.map((r) => ({
              product_id: r.product.product_id,
              quantity: r.quantity,
              total_minor: r.total_amount_minor,
              currency: r.product.currency,
              discrepancies: r.discrepancies,
            })),
            events: events.length,
            synthetic_events: events.filter(
              (e) => e.provenance.mode === "synthetic",
            ).length,
          }),
        );
        if (result.status !== "completed" || !result.recommendations.length)
          process.exitCode = 1;
      }
    }
  } finally {
    store.close();
  }
}
void main().catch(() => {
  console.log(
    JSON.stringify({ status: "failed", error_code: "smoke_setup_failed" }),
  );
  process.exitCode = 1;
});
