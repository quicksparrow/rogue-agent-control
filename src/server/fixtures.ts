import { randomUUID } from "node:crypto";
import type { Run } from "../lib/contracts";

// Entirely synthetic evidence. No adapter, LLM, catalog service or payment call.
// Text lives in reviewed code, never accepted as arbitrary prompt input.
export function scenarioEvents(run: Run): unknown[] {
  const deviation = run.scenario === "deviation";
  const business = run.persona === "business";
  const merchant = deviation ? "unapproved_market" : run.policy.merchant_ids[0];
  const product = business ? "desk_bundle_02" : "running_shoe_02";
  const amount = business
    ? deviation
      ? 129900
      : 89900
    : deviation
      ? 34900
      : 12900;
  const start = Date.parse(run.created_at) - 8000;
  const ids = Array.from({ length: 7 }, () => `evt_${randomUUID()}`);
  const definitions = [
    {
      actor: "human",
      event_type: "mandate_recorded",
      tool: null,
      payload: {
        intent: business ? "office_equipment" : "running_shoes",
        max_total_minor: run.policy.max_total_minor,
        currency: run.policy.currency,
        merchant_ids: run.policy.merchant_ids,
      },
    },
    {
      actor: "catalog",
      event_type: "catalog_observed",
      tool: "catalog.search",
      payload: {
        catalog_mode: "offline",
        product_ids: [business ? "desk_bundle_01" : "running_shoe_01", product],
        result_count: 2,
      },
    },
    {
      actor: "catalog",
      event_type: "external_content_observed",
      tool: null,
      payload: {
        product_id: product,
        fixture_code: deviation ? "injected_listing_v1" : "clean_listing_v1",
        content_trust: "untrusted",
      },
    },
    {
      actor: "shopping_agent",
      event_type: "model_response_recorded",
      tool: "ollama.generate",
      payload: {
        model: "qwen3:4b",
        outcome: "proposal",
        selected_product_id: product,
      },
    },
    {
      actor: "shopping_agent",
      event_type: "purchase_proposed",
      tool: null,
      payload: {
        product_id: product,
        merchant_id: merchant,
        unit_amount_minor: amount,
        total_amount_minor: amount,
        quantity: 1,
        currency: "USD",
      },
    },
    {
      actor: "collector",
      event_type: "evidence_gap",
      tool: null,
      payload: { code: "integration_not_connected" },
    },
    {
      actor: "collector",
      event_type: "run_finished",
      tool: null,
      payload: { outcome: "recorded" },
    },
  ];
  return definitions.map((definition, i) => ({
    ...definition,
    schema_version: 1,
    event_id: ids[i],
    parent_event_id: i ? ids[i - 1] : null,
    timestamp: new Date(start + i * 1000).toISOString(),
  }));
}
