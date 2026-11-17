import { z } from "zod";
import { currency, identifier, policySchema } from "./contracts";
import { shoppingInputSchema } from "./shopping-contracts";
import { outcomes, ruleIds, firewallReasons } from "./firewall-vocabulary";

const money = z.number().int().min(0).max(1_000_000_000);
export const policyConfigurationSchema = z
  .object({
    parent_version: identifier.optional(),
    label: z.string().trim().min(3).max(80),
    persona: z.enum(["consumer", "business"]),
    currency,
    max_transaction_minor: money,
    min_quantity: z.number().int().min(1).max(10000),
    max_quantity: z.number().int().min(1).max(10000),
    quantity_mismatch: z.enum(["DENY", "REVIEW"]),
    automatic_approval_minor: money,
    require_human_approval: z.boolean(),
    approved_merchant_ids: z.array(identifier).max(20),
    prohibited_merchant_ids: z.array(identifier).max(20),
  })
  .strict()
  .refine(
    (p) =>
      p.min_quantity <= p.max_quantity &&
      p.automatic_approval_minor <= p.max_transaction_minor,
    "Invalid authority or quantity range",
  );
export type PolicyConfiguration = z.infer<typeof policyConfigurationSchema>;
export const ownerPolicySchema = policyConfigurationSchema.safeExtend({
  policy_id: identifier,
  version: identifier,
  revision: z.number().int().positive(),
  owner_id: identifier,
  registry_version: identifier,
  created_at: z.string().datetime(),
  usage: z.enum(["shopping", "fixture"]).default("shopping"),
});
export type OwnerPolicy = z.infer<typeof ownerPolicySchema>;
export const merchantRegistrySchema = z
  .object({
    version: identifier,
    mappings: z
      .array(
        z
          .object({
            catalog_source: z.literal("offline"),
            provider_merchant_id: identifier,
            merchant_id: identifier,
            label: z.string().max(80),
            verified: z.literal(true),
            scope: z.literal("demo_only"),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type MerchantRegistry = z.infer<typeof merchantRegistrySchema>;
export const mandateRecordSchema = shoppingInputSchema.extend({
  mandate_id: identifier,
  identity: z
    .object({
      owner_id: identifier,
      agent_id: identifier,
      attribution: z.literal("application_configuration"),
      authenticated: z.literal(false),
      authorized_context: z.enum([
        "recommendations_only",
        "policy_controlled_proposals",
      ]),
    })
    .strict(),
  created_at: z.string().datetime(),
  omitted_sensitive_fields: z.number().int().min(0).max(5),
  firewall: z
    .object({ owner_policy_version: identifier, registry_version: identifier })
    .strict()
    .optional(),
});

export const actionSchema = z
  .object({
    operation: z.literal("payment.create_order"),
    product_id: identifier,
    source_product_id: identifier,
    catalog_source: z.enum(["offline", "channel3"]),
    provider_merchant_id: identifier,
    unit_amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    total_amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    quantity: z.number().int().min(1).max(10000),
    currency,
  })
  .strict();
export type ProposedAction = z.infer<typeof actionSchema>;
export interface ActionRecord {
  proposal_id: string;
  run_id: string;
  source_event_id: string;
  recommendation_index: number;
  mandate_id: string;
  agent_id: string;
  owner_id: string;
  policy_id: string;
  policy_version: string;
  owner_policy_version: string;
  registry_version: string;
  created_at: string;
  action: ProposedAction;
  evidence_mode: "actual_agent" | "synthetic_fixture";
}
export const evaluationSchema = z
  .object({
    outcome: z.enum(outcomes),
    rule_ids: z.array(z.enum(ruleIds)).min(1),
    reason_codes: z.array(z.enum(firewallReasons)).min(1),
  })
  .strict();
export type Evaluation = z.infer<typeof evaluationSchema>;
export interface FirewallDecision extends Evaluation {
  decision_id: string;
  run_id: string;
  agent_id: string;
  mandate_id: string;
  owner_id: string;
  policy_id: string;
  policy_version: string;
  owner_policy_id: string | null;
  owner_policy_version: string;
  registry_version: string;
  proposal_id: string;
  proposed_action_reference: string;
  timestamp: string;
}
export interface GatewayResult {
  proposal: ActionRecord;
  decision: FirewallDecision;
  execution_eligible: boolean;
  state:
    | "blocked"
    | "review_pending"
    | "eligible_no_adapter"
    | "mock_executing"
    | "mock_completed"
    | "mock_unknown";
  payment_executed: false;
}
export interface FirewallView {
  owner_policy: OwnerPolicy | null;
  proposals: ActionRecord[];
  decisions: FirewallDecision[];
  // Legacy Phase 3 evaluation view: this stage itself never installs or dispatches an adapter.
  // Current sandbox availability is resolved independently by the payment gateway.
  payment_adapter_installed: false;
}
export const scenarioIds = [
  "allowed",
  "over_budget",
  "quantity_mismatch",
  "unknown_merchant",
  "approval_required",
] as const;
export type ScenarioId = (typeof scenarioIds)[number];

export function exactTotal(unit: number, quantity: number): number {
  if (
    !Number.isSafeInteger(unit) ||
    unit <= 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 10000
  )
    throw new Error("Invalid exact amount arguments");
  const total = BigInt(unit) * BigInt(quantity);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount overflow");
  return Number(total);
}

export const evaluateReferenceSchema = z
  .object({ proposal_id: identifier })
  .strict();
export { policySchema };
