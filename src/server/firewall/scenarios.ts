import type { BlackBoxStore } from "../store";
import { createShoppingRun, Recorder } from "../shopping/runtime";
import { ensureOwnerPolicies, createOwnerPolicy } from "./policies";
import { recordProposal, authorizeProposal } from "./gateway";
import type { ScenarioId } from "../../lib/firewall-contracts";
import type { Product, Recommendation } from "../../lib/shopping-contracts";

/** Fresh, labeled synthetic proposals through the real Firewall. Never a bypass or model claim. */
export function createFirewallScenario(
  store: BlackBoxStore,
  scenario: ScenarioId,
) {
  ensureOwnerPolicies(store);
  const business = scenario === "quantity_mismatch";
  const quantity = 1,
    requested = business ? 10 : 1;
  const amount = scenario === "over_budget" ? 15100 : business ? 1495 : 14900;
  const provider =
    scenario === "unknown_merchant"
      ? "unmapped_merchant"
      : business
        ? "seed_office"
        : "seed_sports";
  return store.db
    .transaction(() => {
      const ownerPolicy = createOwnerPolicy(
        store,
        {
          label: `Controlled fixture / ${scenario}`,
          persona: business ? "business" : "consumer",
          currency: "USD",
          max_transaction_minor: business ? 25000 : 15000,
          min_quantity: 1,
          max_quantity: business ? 10 : 1,
          quantity_mismatch: business ? "REVIEW" : "DENY",
          automatic_approval_minor:
            scenario === "approval_required" ? 10000 : business ? 25000 : 15000,
          require_human_approval: false,
          approved_merchant_ids: [business ? "demo_office" : "demo_sports"],
          prohibited_merchant_ids: [],
        },
        "fixture",
      );
      const run = createShoppingRun(
        store,
        {
          persona: business ? "business" : "consumer",
          catalog_mode: "offline",
          objective: `Controlled synthetic Firewall fixture: ${scenario}. No model or financial call.`,
          budget_minor: business ? 25000 : 15000,
          currency: "USD",
          quantity: requested,
          preferences: ["Controlled policy demonstration"],
          merchant_ids: [provider],
        },
        { policy: ownerPolicy, fixture: true },
      );
      store.db
        .prepare("UPDATE runs SET title=? WHERE run_id=?")
        .run(`Policy fixture / ${scenario.replaceAll("_", " ")}`, run.run_id);
      store.claimShopping(run.run_id);
      const product: Product = {
        product_id: `fixture_${scenario}`,
        source_product_id: `fixture_${scenario}`,
        title: `Controlled synthetic proposal / ${scenario}`,
        merchant_id: provider,
        unit_amount_minor: amount,
        currency: "USD",
        availability: "in_stock",
        source: "offline",
        source_reference: `firewall_fixture_v1:${scenario}`,
        description_omitted: true,
      };
      const recommendation: Recommendation = {
        product,
        quantity,
        total_amount_minor: amount,
        reason_codes: ["closest_match"],
        discrepancies: business
          ? ["quantity_differs"]
          : scenario === "over_budget"
            ? ["above_budget"]
            : [],
        estimate_only: true,
      };
      store.saveShoppingProducts(run.run_id, [product]);
      store.finishShopping(run.run_id, [recommendation], null);
      const recorder = new Recorder(store, run.run_id);
      const source = recorder.emit("recommendation_recorded", {
        product_id: product.product_id,
        merchant_id: provider,
        unit_amount_minor: amount,
        total_amount_minor: amount,
        currency: "USD",
        quantity,
        estimate_only: true,
      });
      const proposal = recordProposal(store, run.run_id, 0, source);
      const result = authorizeProposal(store, proposal.proposal_id);
      recorder.emit("run_finished", { outcome: "recorded" });
      return { run: store.getRun(run.run_id), ...result };
    })
    .immediate();
}
