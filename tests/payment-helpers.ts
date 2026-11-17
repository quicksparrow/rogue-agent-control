import { seededProducts } from "../src/server/shopping/catalog";
import { createControlledShoppingRun } from "../src/server/firewall/shopping";
import { Recorder } from "../src/server/shopping/runtime";
import {
  recordProposal,
  authorizeProposal,
} from "../src/server/firewall/gateway";
import type { BlackBoxStore } from "../src/server/store";
import type { PaymentContext } from "../src/lib/payment-contracts";
import { paypalDecimal } from "../src/lib/payment-contracts";
export function preparePayment(
  store: BlackBoxStore,
  options: {
    budget?: number;
    quantity?: number;
    proposedQuantity?: number;
    productIds?: string[];
    ownerPolicy?: string;
  } = {},
) {
  const run = createControlledShoppingRun(store, {
    persona: "consumer",
    catalog_mode: "offline",
    objective: "Mocked payment-boundary test. No real model or payment.",
    budget_minor: options.budget ?? 15000,
    currency: "USD",
    quantity: options.quantity ?? 1,
    preferences: [],
    merchant_ids: ["seed_sports"],
    ...(options.ownerPolicy
      ? { owner_policy_version: options.ownerPolicy }
      : {}),
  });
  const products = (options.productIds ?? ["seed_shoes_daily"]).map((id) => ({
    ...seededProducts.find((p) => p.product_id === id)!,
  }));
  store.claimShopping(run.run_id);
  store.saveShoppingProducts(run.run_id, products);
  const recommendations = products.map((product) => ({
    product,
    quantity: options.proposedQuantity ?? 1,
    total_amount_minor:
      product.unit_amount_minor * (options.proposedQuantity ?? 1),
    reason_codes: ["price" as const],
    discrepancies: [],
    estimate_only: true as const,
  }));
  store.finishShopping(run.run_id, recommendations, null);
  const recorder = new Recorder(store, run.run_id);
  const proposals = recommendations.map((r, i) => {
    const source = recorder.emit("recommendation_recorded", {
      product_id: r.product.product_id,
      merchant_id: r.product.merchant_id,
      unit_amount_minor: r.product.unit_amount_minor,
      total_amount_minor: r.total_amount_minor,
      quantity: r.quantity,
      currency: r.product.currency,
      estimate_only: true,
    });
    const p = recordProposal(store, run.run_id, i, source);
    authorizeProposal(store, p.proposal_id);
    return p;
  });
  return { run, proposals, proposal: proposals[0] };
}
export function providerOrder(
  c: PaymentContext,
  status = "CREATED",
  capture = false,
) {
  return {
    id: "ORDER123456789",
    intent: "CAPTURE",
    status,
    purchase_units: [
      {
        reference_id: c.proposal_id,
        custom_id: c.proposal_id,
        amount: {
          currency_code: c.currency,
          value: paypalDecimal(c.total_amount_minor, c.currency),
        },
        payee: { merchant_id: c.seller_merchant_id },
        items: [
          {
            sku: c.source_product_id,
            name: "Sandbox item",
            quantity: String(c.quantity),
            unit_amount: {
              currency_code: c.currency,
              value: paypalDecimal(c.unit_amount_minor, c.currency),
            },
          },
        ],
        ...(capture
          ? {
              payments: {
                captures: [
                  {
                    id: "CAPTURE1234567",
                    status: "COMPLETED",
                    amount: {
                      currency_code: c.currency,
                      value: paypalDecimal(c.total_amount_minor, c.currency),
                    },
                    final_capture: true,
                  },
                ],
              },
            }
          : {}),
      },
    ],
    links: [
      {
        rel: "payer-action",
        method: "GET",
        href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123456789",
      },
    ],
    payer: {
      email_address: "BUYER_PII_CANARY@example.com",
      name: { given_name: "DO_NOT_PERSIST_BUYER" },
    },
  };
}
export const testEnv = {
  PAYPAL_MODE: "sandbox",
  PAYPAL_ENVIRONMENT: "sandbox",
  PAYPAL_CLIENT_ID: "MOCK_CLIENT_ID_12345",
  PAYPAL_CLIENT_SECRET: "MOCK_SECRET_12345",
  PAYPAL_SANDBOX_MERCHANT_ID: "ABCD2345EFGHJ",
  PAYPAL_SANDBOX_DEMO_MERCHANT_IDS: "demo_sports,demo_office",
  PAYPAL_RETURN_BASE_URL: "http://127.0.0.1:3000",
  ROGUE_OWNER_ID: "local_buyer",
  ROGUE_AGENT_ID: "shopping_qwen3",
};
