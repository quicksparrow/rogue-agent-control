import {
  actionSchema,
  exactTotal,
  mandateRecordSchema,
  ownerPolicySchema,
  merchantRegistrySchema,
  policySchema,
  type Evaluation,
} from "../../lib/firewall-contracts";
import { productSchema } from "../../lib/shopping-contracts";
import type { firewallReasons, ruleIds } from "../../lib/firewall-vocabulary";

export interface EvaluationContext {
  mandate: unknown;
  policy: unknown;
  owner_policy: unknown;
  registry: unknown;
  products: unknown;
  expected: {
    owner_id: string;
    agent_id: string;
    mandate_id: string;
    policy_id: string;
    policy_version: string;
    owner_policy_version: string;
    registry_version: string;
  };
}

/** Pure, bounded, deterministic authorization. No model, network, environment, time or side effects. */
export function evaluatePolicy(
  rawAction: unknown,
  context: EvaluationContext,
): Evaluation {
  const evaluated: (typeof ruleIds)[number][] = [];
  const denied: (typeof firewallReasons)[number][] = [],
    review: (typeof firewallReasons)[number][] = [];
  const fail = (
    rule: (typeof ruleIds)[number],
    reason: (typeof firewallReasons)[number],
  ): Evaluation => ({
    outcome: "DENY",
    rule_ids: [...evaluated, rule],
    reason_codes: [reason],
  });
  const action = actionSchema.safeParse(rawAction);
  if (!action.success) return fail("action.valid", "ACTION_INVALID");
  if (
    action.data.unit_amount_minor === 0 ||
    action.data.total_amount_minor === 0
  )
    return fail("amount.exact", "AMOUNT_INVALID");
  evaluated.push("action.valid");
  const mandate = mandateRecordSchema.safeParse(context.mandate);
  if (!mandate.success) return fail("identity.owner", "MANDATE_INVALID");
  const policy = policySchema.safeParse(context.policy);
  if (!context.policy || !context.owner_policy)
    return fail("policy.binding", "POLICY_MISSING");
  const owner = ownerPolicySchema.safeParse(context.owner_policy);
  const registry = merchantRegistrySchema.safeParse(context.registry);
  if (!policy.success || !owner.success || !registry.success)
    return fail("policy.binding", "POLICY_INVALID");
  const a = action.data,
    m = mandate.data,
    p = policy.data,
    o = owner.data,
    r = registry.data,
    e = context.expected;
  evaluated.push("identity.owner");
  if (
    m.identity.owner_id !== e.owner_id ||
    m.identity.agent_id !== e.agent_id ||
    p.owner_id !== e.owner_id ||
    o.owner_id !== e.owner_id ||
    m.mandate_id !== e.mandate_id
  )
    denied.push("IDENTITY_MISMATCH");
  evaluated.push("policy.binding");
  if (
    !p.firewall ||
    !m.firewall ||
    p.version !== e.policy_version ||
    p.version !== e.policy_id ||
    p.firewall.owner_policy_version !== e.owner_policy_version ||
    m.firewall.owner_policy_version !== e.owner_policy_version ||
    o.version !== e.owner_policy_version ||
    p.firewall.registry_version !== e.registry_version ||
    m.firewall.registry_version !== e.registry_version ||
    r.version !== e.registry_version ||
    o.registry_version !== e.registry_version ||
    o.persona !== m.persona
  )
    denied.push("POLICY_BINDING_MISMATCH");
  evaluated.push("catalog.grounding");
  const products =
    Array.isArray(context.products) && context.products.length <= 4
      ? context.products
      : [];
  const product = products
    .map((value) => productSchema.safeParse(value))
    .find((value) => value.success && value.data.product_id === a.product_id);
  if (
    !product?.success ||
    product.data.source_product_id !== a.source_product_id ||
    product.data.merchant_id !== a.provider_merchant_id ||
    product.data.source !== a.catalog_source ||
    product.data.unit_amount_minor !== a.unit_amount_minor ||
    product.data.currency !== a.currency
  )
    denied.push("PRODUCT_NOT_GROUNDED");
  evaluated.push("currency.match");
  if (
    a.currency !== m.currency ||
    a.currency !== p.currency ||
    a.currency !== o.currency
  )
    denied.push("CURRENCY_MISMATCH");
  evaluated.push("amount.exact");
  let total: number | null = null;
  try {
    total = exactTotal(a.unit_amount_minor, a.quantity);
    if (total !== a.total_amount_minor) denied.push("AMOUNT_INVALID");
  } catch {
    denied.push("AMOUNT_INVALID");
  }
  evaluated.push("budget.transaction");
  if (
    total !== null &&
    (total > m.budget_minor ||
      total > p.max_total_minor ||
      total > o.max_transaction_minor)
  )
    denied.push("BUDGET_EXCEEDED");
  evaluated.push("merchant.mapping");
  const mapping = r.mappings.find(
    (item) =>
      item.catalog_source === a.catalog_source &&
      item.provider_merchant_id === a.provider_merchant_id &&
      item.verified,
  );
  if (!mapping) denied.push("MERCHANT_UNVERIFIED");
  evaluated.push("merchant.permissions");
  if (mapping && o.prohibited_merchant_ids.includes(mapping.merchant_id))
    denied.push("MERCHANT_PROHIBITED");
  if (mapping && !o.approved_merchant_ids.includes(mapping.merchant_id))
    denied.push("MERCHANT_NOT_APPROVED");
  if (
    !m.merchant_ids.includes(a.provider_merchant_id) ||
    !p.merchant_ids.includes(a.provider_merchant_id)
  )
    denied.push("MERCHANT_OUTSIDE_MANDATE");
  evaluated.push("quantity.range");
  if (
    a.quantity < o.min_quantity ||
    a.quantity > o.max_quantity ||
    a.quantity > p.max_quantity
  )
    denied.push("QUANTITY_OUT_OF_RANGE");
  evaluated.push("quantity.mandate");
  if (a.quantity !== m.quantity)
    (o.quantity_mismatch === "DENY" ? denied : review).push(
      "QUANTITY_MISMATCH",
    );
  evaluated.push("approval.authority");
  if (p.approval_required || o.require_human_approval)
    review.push("HUMAN_APPROVAL_REQUIRED");
  if (total !== null && total > o.automatic_approval_minor)
    review.push("AUTOMATIC_AUTHORITY_EXCEEDED");
  evaluated.push("context.scope");
  if (m.identity.authorized_context !== "policy_controlled_proposals")
    denied.push("CONTEXT_NOT_AUTHORIZED");
  return {
    outcome: denied.length ? "DENY" : review.length ? "REVIEW" : "ALLOW",
    rule_ids: evaluated,
    reason_codes: [...new Set([...denied, ...review])].length
      ? [...new Set([...denied, ...review])]
      : ["RULES_SATISFIED"],
  };
}
