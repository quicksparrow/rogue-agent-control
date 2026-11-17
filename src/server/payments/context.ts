import { requireCurrentAllowance } from "../firewall/gateway";
import { getRegistry } from "../firewall/policies";
import { seededProducts } from "../shopping/catalog";
import type { BlackBoxStore } from "../store";
import type { PaymentContext } from "../../lib/payment-contracts";
import { exactTotal } from "../../lib/firewall-contracts";
import { sandboxConfig, PaymentError } from "./config";
export function trustedPaymentContext(
  store: BlackBoxStore,
  proposalId: string,
): PaymentContext {
  const result = requireCurrentAllowance(store, proposalId);
  if (result.decision.outcome !== "ALLOW")
    throw new PaymentError(
      result.decision.outcome === "REVIEW"
        ? "OWNER_REVIEW_PENDING"
        : "POLICY_BLOCKED",
    );
  const p = result.proposal,
    a = p.action;
  if (
    p.evidence_mode !== "actual_agent" ||
    store.getRun(p.run_id).recording_kind !== "shopping"
  )
    throw new PaymentError("SYNTHETIC_NOT_EXECUTABLE");
  const config = sandboxConfig();
  const mapping = getRegistry(store, p.registry_version).mappings.find(
    (m) =>
      m.catalog_source === a.catalog_source &&
      m.provider_merchant_id === a.provider_merchant_id &&
      m.verified &&
      m.scope === "demo_only",
  );
  if (
    !mapping ||
    a.catalog_source !== "offline" ||
    !config.demoMerchantIds.includes(mapping.merchant_id)
  )
    throw new PaymentError("SELLER_UNMAPPED");
  const original = store
    .getShopping(p.run_id)
    .products.find((product) => product.product_id === a.product_id);
  const seed = seededProducts.find(
    (product) => product.product_id === a.product_id,
  );
  if (
    !seed ||
    !original ||
    seed.source_product_id !== a.source_product_id ||
    seed.merchant_id !== a.provider_merchant_id ||
    seed.unit_amount_minor !== a.unit_amount_minor ||
    seed.currency !== a.currency ||
    seed.source_reference !== original.source_reference ||
    seed.availability !== "in_stock" ||
    original.availability !== "in_stock" ||
    exactTotal(a.unit_amount_minor, a.quantity) !== a.total_amount_minor
  )
    throw new PaymentError("TRANSACTION_DATA_UNVERIFIED");
  return {
    proposal_id: p.proposal_id,
    run_id: p.run_id,
    mandate_id: p.mandate_id,
    owner_id: p.owner_id,
    decision_id: result.decision.decision_id,
    policy_version: p.policy_version,
    owner_policy_version: p.owner_policy_version,
    registry_version: p.registry_version,
    catalog_merchant_id: a.provider_merchant_id,
    application_merchant_id: mapping.merchant_id,
    seller_merchant_id: config.sellerMerchantId,
    seller_mapping_version: config.mappingVersion,
    terms_version: "seed_sandbox_terms_v1",
    return_base_url: config.returnBaseUrl,
    product_id: a.product_id,
    source_product_id: a.source_product_id,
    quantity: a.quantity,
    currency: a.currency,
    unit_amount_minor: a.unit_amount_minor,
    total_amount_minor: a.total_amount_minor,
  };
}
