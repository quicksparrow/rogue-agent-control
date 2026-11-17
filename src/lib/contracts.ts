import { z } from "zod";
import { paymentStates, paymentErrors } from "./payment-vocabulary";
import type { ShoppingExecution } from "./shopping-contracts";
import { outcomes, ruleIds, firewallReasons } from "./firewall-vocabulary";

export const SCHEMA_VERSION = 1 as const;
// Structured identifiers only. Generic ingestion deliberately does not accept prompts,
// headers, free-form explanations, buyer data, URLs, or arbitrary metadata.
export const identifier = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
  .refine(
    (value) => !/^(sk-|sk_|Bearer|eyJ)/i.test(value),
    "Sensitive-looking identifier",
  );
export const currency = z.enum(["USD", "EUR", "GBP", "CAD", "MXN"]);
const minor = z.number().int().min(0).max(1_000_000_000);
const quantity = z.number().int().min(1).max(10_000);
export const personaSchema = z.enum(["consumer", "business"]);
export type Persona = z.infer<typeof personaSchema>;
export const scenarioSchema = z.enum(["deviation", "authorized"]);
export type Scenario = z.infer<typeof scenarioSchema>;

export const policySchema = z
  .object({
    version: identifier,
    owner_id: identifier,
    max_total_minor: minor,
    currency,
    merchant_ids: z.array(identifier).min(1).max(30),
    max_quantity: quantity,
    approval_required: z.boolean(),
    firewall: z
      .object({
        owner_policy_version: identifier,
        registry_version: identifier,
      })
      .strict()
      .optional(),
  })
  .strict();
export type PolicySnapshot = z.infer<typeof policySchema>;

const payloadSchemas = {
  mandate_recorded: z.object({
    intent: z.enum(["running_shoes", "office_equipment"]),
    max_total_minor: minor,
    currency,
    merchant_ids: z.array(identifier).max(30),
  }),
  catalog_observed: z.object({
    catalog_mode: z.enum(["offline", "channel3"]),
    product_ids: z.array(identifier).max(100),
    result_count: z.number().int().min(0).max(100),
  }),
  external_content_observed: z.object({
    product_id: identifier,
    fixture_code: z.enum(["injected_listing_v1", "clean_listing_v1"]),
    content_trust: z.literal("untrusted"),
  }),
  model_response_recorded: z.object({
    model: z.enum(["qwen3:4b"]),
    outcome: z.enum(["proposal", "invalid", "timeout"]),
    selected_product_id: identifier.optional(),
  }),
  tool_call_started: z.object({
    operation: z.enum([
      "catalog.search",
      "paypal.create_order",
      "paypal.capture",
    ]),
    request_id: identifier,
  }),
  tool_call_completed: z.object({
    operation: z.enum([
      "catalog.search",
      "paypal.create_order",
      "paypal.capture",
    ]),
    request_id: identifier,
    result: z.enum(["success", "failed", "unknown"]),
  }),
  purchase_proposed: z.object({
    product_id: identifier,
    merchant_id: identifier,
    unit_amount_minor: minor,
    total_amount_minor: minor,
    currency,
    quantity,
  }),
  policy_evaluated: z.object({
    decision: z.enum(["allow", "deny", "review", "disabled_test_only"]),
    rule_codes: z
      .array(
        z.enum([
          "over_budget",
          "merchant_not_allowed",
          "currency_mismatch",
          "quantity_exceeded",
          "approval_required",
        ]),
      )
      .max(5),
  }),
  payment_status_recorded: z.object({
    state: z.enum([
      "proposed",
      "blocked",
      "order_created",
      "buyer_approved",
      "captured",
      "failed",
      "unknown_reconciling",
    ]),
    order_reference: identifier.optional(),
  }),
  run_finished: z.object({
    outcome: z.enum(["recorded", "failed", "incomplete"]),
  }),
  evidence_gap: z.object({
    code: z.enum([
      "missing_parent",
      "missing_tool_response",
      "collector_interrupted",
      "integration_not_connected",
    ]),
  }),
};
const legacyEventTypes = Object.keys(payloadSchemas) as [
  keyof typeof payloadSchemas,
  ...(keyof typeof payloadSchemas)[],
];
const runtimePayloadSchemas = {
  run_created: z.object({
    catalog_mode: z.enum(["offline", "channel3"]),
    mandate_id: identifier,
    agent_id: identifier,
    owner_id: identifier,
    authorized_context: z.enum([
      "recommendations_only",
      "policy_controlled_proposals",
    ]),
  }),
  mandate_captured: z.object({
    mandate_id: identifier,
    owner_id: identifier,
    agent_id: identifier,
    max_total_minor: minor,
    currency,
    quantity,
    objective_digest: z.string().regex(/^[a-f0-9]{64}$/),
    preferences_count: z.number().int().min(0).max(4),
    omitted_sensitive_fields: z.number().int().min(0).max(5),
  }),
  model_invoked: z.object({
    invocation_id: identifier,
    step: z.enum(["search", "recommend"]),
    model: z.literal("qwen3:4b"),
    context_length: z.number().int().min(2048).max(32768),
    think: z.boolean(),
  }),
  model_completed: z.object({
    invocation_id: identifier,
    step: z.enum(["search", "recommend"]),
    outcome: z.enum(["completed", "failed"]),
    prompt_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
  }),
  tool_proposed: z.object({
    operation: z.enum([
      "catalog.search",
      "catalog.get_product",
      "unregistered",
    ]),
    request_id: identifier,
  }),
  tool_validated: z.object({
    operation: z.enum(["catalog.search", "catalog.get_product"]),
    request_id: identifier,
    query: z
      .string()
      .max(100)
      .regex(/^[\p{L}\p{N} ,.'-]+$/u)
      .optional(),
    limit: z.number().int().min(1).max(4).optional(),
    product_id: identifier.optional(),
  }),
  catalog_requested: z.object({
    operation: z.enum(["catalog.search", "catalog.get_product"]),
    request_id: identifier,
    catalog_mode: z.enum(["offline", "channel3"]),
  }),
  catalog_received: z.object({
    operation: z.enum(["catalog.search", "catalog.get_product"]),
    request_id: identifier,
    catalog_mode: z.enum(["offline", "channel3"]),
    result_count: z.number().int().min(0).max(4),
    products: z
      .array(
        z.object({
          product_id: identifier,
          source_product_id: identifier,
          merchant_id: identifier,
          unit_amount_minor: minor,
          currency,
          availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
        }),
      )
      .max(4),
    content_trust: z.literal("untrusted"),
    descriptions_omitted: z.literal(true),
  }),
  catalog_failed: z.object({
    request_id: identifier,
    error_code: z.enum([
      "unavailable",
      "timeout",
      "cancelled",
      "not_configured",
      "authentication_failed",
      "rate_limited",
      "credits_required",
      "service_error",
      "malformed_catalog",
      "ungrounded_product",
    ]),
  }),
  product_selected: z.object({
    product_id: identifier,
    source_product_id: identifier,
    quantity,
    reason_codes: z
      .array(
        z.enum([
          "price",
          "preferences",
          "availability",
          "budget_fit",
          "closest_match",
        ]),
      )
      .max(3),
  }),
  recommendation_recorded: z.object({
    product_id: identifier,
    merchant_id: identifier,
    unit_amount_minor: minor,
    total_amount_minor: z.number().int().min(0).max(10_000_000_000_000),
    currency,
    quantity,
    estimate_only: z.literal(true),
  }),
  execution_failed: z.object({
    error_code: z.enum([
      "unavailable",
      "model_unavailable",
      "timeout",
      "invalid_model_output",
      "invalid_tool_arguments",
      "ungrounded_product",
      "malformed_catalog",
      "empty_catalog",
      "not_configured",
      "authentication_failed",
      "rate_limited",
      "credits_required",
      "service_error",
      "context_limit",
      "configuration",
      "execution_limit",
      "cancelled",
    ]),
  }),
  execution_completed: z.object({
    recommendation_count: z.number().int().min(0).max(2),
    model_calls: z.number().int().min(1).max(2),
    tool_calls: z.number().int().min(1).max(3),
    no_match: z.boolean(),
  }),
  run_finished: payloadSchemas.run_finished,
};
const firewallRefs = {
  proposal_id: identifier,
  mandate_id: identifier,
  agent_id: identifier,
  policy_id: identifier,
  policy_version: identifier,
  owner_policy_version: identifier,
  registry_version: identifier,
};
const firewallPayloadSchemas = {
  action_proposed: z.object({
    ...firewallRefs,
    product_id: identifier,
    source_event_id: identifier,
    operation: z.literal("payment.create_order"),
    quantity,
    unit_amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    total_amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency,
    provider_merchant_id: identifier,
    evidence_mode: z.enum(["actual_agent", "synthetic_fixture"]),
  }),
  policy_evaluation_requested: z.object(firewallRefs),
  policy_decision_recorded: z.object({
    ...firewallRefs,
    decision_id: identifier,
    outcome: z.enum(outcomes),
    rule_ids: z.array(z.enum(ruleIds)).min(1),
    reason_codes: z.array(z.enum(firewallReasons)).min(1),
  }),
  gateway_eligibility_recorded: z.object({
    proposal_id: identifier,
    decision_id: identifier,
    execution_eligible: z.boolean(),
    state: z.enum(["blocked", "review_pending", "eligible_no_adapter"]),
    payment_executed: z.literal(false),
  }),
  gateway_test_dispatch: z.object({
    proposal_id: identifier,
    decision_id: identifier,
    state: z.enum(["mock_executing", "mock_completed", "mock_unknown"]),
    test_only: z.literal(true),
    payment_executed: z.literal(false),
  }),
  gateway_error: z.object({
    proposal_id: identifier,
    code: z.enum([
      "EVALUATION_UNAVAILABLE",
      "CONTEXT_CHANGED",
      "DISPATCH_BLOCKED",
      "INVALID_GATEWAY_REQUEST",
    ]),
    payment_executed: z.literal(false),
  }),
};
const paymentRef = { proposal_id: identifier, payment_id: identifier };
const paymentStatus = z
  .enum([
    "CREATED",
    "SAVED",
    "APPROVED",
    "VOIDED",
    "COMPLETED",
    "PAYER_ACTION_REQUIRED",
  ])
  .nullable();
const captureStatus = z
  .enum([
    "COMPLETED",
    "PENDING",
    "DECLINED",
    "FAILED",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
  ])
  .nullable()
  .optional();
const paymentPayloadSchemas = {
  payment_claimed: z.object({
    ...paymentRef,
    mandate_id: identifier,
    decision_id: identifier,
    seller_mapping_version: identifier,
    catalog_merchant_id: identifier,
    application_merchant_id: identifier,
    terms_version: z.literal("seed_sandbox_terms_v1"),
    currency,
    unit_amount_minor: minor,
    total_amount_minor: minor,
    quantity,
    request_id: identifier,
    sandbox: z.literal(true),
    retailer_fulfillment: z.literal(false),
  }),
  paypal_oauth: z.object({
    ...paymentRef,
    stage: z.enum(["requested", "completed", "failed"]),
    error_code: z.enum(paymentErrors).nullable(),
  }),
  paypal_operation: z.object({
    ...paymentRef,
    operation: z.enum(["create", "lookup", "capture"]),
    stage: z.enum(["requested", "completed", "failed"]),
    request_id: identifier.nullable(),
    order_id: identifier.nullable(),
    provider_status: paymentStatus,
    capture_status: captureStatus,
    error_code: z.enum(paymentErrors).nullable(),
    provider_error_code: identifier.nullable(),
  }),
  payment_state_changed: z.object({
    ...paymentRef,
    state: z.enum(paymentStates),
    provider_status: paymentStatus,
    capture_status: captureStatus,
    order_id: identifier.nullable(),
    capture_id: identifier.nullable(),
    error_code: z.enum(paymentErrors).nullable(),
    cancel_requested: z.boolean(),
    sandbox: z.literal(true),
    retailer_fulfillment: z.literal(false),
  }),
};
export type EventType =
  | keyof typeof payloadSchemas
  | keyof typeof runtimePayloadSchemas
  | keyof typeof firewallPayloadSchemas
  | keyof typeof paymentPayloadSchemas;
export const eventTypes = [
  ...new Set([
    ...legacyEventTypes,
    ...Object.keys(runtimePayloadSchemas),
    ...Object.keys(firewallPayloadSchemas),
    ...Object.keys(paymentPayloadSchemas),
  ]),
] as [EventType, ...EventType[]];
export type RuntimeSource =
  | "application"
  | "ollama"
  | "seed_catalog"
  | "channel3"
  | "policy_firewall"
  | "trusted_gateway"
  | "paypal_sandbox";
export const actors = [
  "human",
  "catalog",
  "shopping_agent",
  "policy_gateway",
  "paypal",
  "collector",
] as const;

const envelope = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    event_id: identifier,
    parent_event_id: identifier.nullable().default(null),
    timestamp: z.string().datetime({ offset: true }),
    actor: z.enum(actors),
    event_type: z.enum(legacyEventTypes),
    tool: z
      .enum([
        "catalog.search",
        "ollama.generate",
        "paypal.create_order",
        "paypal.capture",
      ])
      .nullable()
      .default(null),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export type SafeEventInput = Omit<
  z.infer<typeof envelope>,
  "payload" | "schema_version" | "event_type" | "tool"
> & {
  schema_version: 1 | 2 | 3 | 4;
  event_type: EventType;
  tool:
    | z.infer<typeof envelope>["tool"]
    | "ollama.chat"
    | "catalog.get_product";
  payload: Record<string, unknown>;
  redacted_field_count: number;
};

export function parseEvent(input: unknown): SafeEventInput {
  const parsed = envelope.parse(input);
  const payload = payloadSchemas[parsed.event_type].parse(parsed.payload);
  if (parsed.parent_event_id === parsed.event_id)
    throw new Error("An event cannot parent itself");
  return {
    ...parsed,
    timestamp: new Date(parsed.timestamp).toISOString(),
    payload,
    redacted_field_count: Object.keys(parsed.payload).filter(
      (key) => !(key in payload),
    ).length,
  };
}

const paymentEnvelope = envelope.extend({
  schema_version: z.literal(4),
  event_type: z.enum(
    Object.keys(paymentPayloadSchemas) as [
      keyof typeof paymentPayloadSchemas,
      ...(keyof typeof paymentPayloadSchemas)[],
    ],
  ),
  tool: z.null().default(null),
});
export function parsePaymentEvent(input: unknown): SafeEventInput {
  const parsed = paymentEnvelope.parse(input),
    payload = paymentPayloadSchemas[parsed.event_type].parse(parsed.payload);
  if (parsed.parent_event_id === parsed.event_id)
    throw new Error("An event cannot parent itself");
  return {
    ...parsed,
    timestamp: new Date(parsed.timestamp).toISOString(),
    payload,
    redacted_field_count: Object.keys(parsed.payload).filter(
      (k) => !(k in payload),
    ).length,
  };
}
const firewallEnvelope = envelope.extend({
  schema_version: z.literal(3),
  event_type: z.enum(
    Object.keys(firewallPayloadSchemas) as [
      keyof typeof firewallPayloadSchemas,
      ...(keyof typeof firewallPayloadSchemas)[],
    ],
  ),
  tool: z.null().default(null),
});
export function parseFirewallEvent(input: unknown): SafeEventInput {
  const parsed = firewallEnvelope.parse(input);
  const payload = firewallPayloadSchemas[parsed.event_type].parse(
    parsed.payload,
  );
  if (parsed.parent_event_id === parsed.event_id)
    throw new Error("An event cannot parent itself");
  return {
    ...parsed,
    timestamp: new Date(parsed.timestamp).toISOString(),
    payload,
    redacted_field_count: Object.keys(parsed.payload).filter(
      (key) => !(key in payload),
    ).length,
  };
}

const runtimeEnvelope = envelope.extend({
  schema_version: z.literal(2),
  event_type: z.enum(
    Object.keys(runtimePayloadSchemas) as [
      keyof typeof runtimePayloadSchemas,
      ...(keyof typeof runtimePayloadSchemas)[],
    ],
  ),
  tool: z
    .enum(["catalog.search", "catalog.get_product", "ollama.chat"])
    .nullable()
    .default(null),
});
/** Schema v2 is for server instrumentation only; external ingestion still accepts v1 exclusively. */
export function parseRuntimeEvent(input: unknown): SafeEventInput {
  const parsed = runtimeEnvelope.parse(input);
  const payload = runtimePayloadSchemas[parsed.event_type].parse(
    parsed.payload,
  );
  if (parsed.parent_event_id === parsed.event_id)
    throw new Error("An event cannot parent itself");
  return {
    ...parsed,
    timestamp: new Date(parsed.timestamp).toISOString(),
    payload,
    redacted_field_count: Object.keys(parsed.payload).filter(
      (key) => !(key in payload),
    ).length,
  };
}

export interface StoredEvent extends SafeEventInput {
  run_id: string;
  trace_id: string;
  policy_version: string;
  sequence: number;
  recorded_at: string;
  provenance: {
    source: "synthetic_fixture" | "external_ingestion" | RuntimeSource;
    trusted: boolean;
    mode: "synthetic" | "external" | "integration";
  };
}

export interface Run {
  run_id: string;
  trace_id: string;
  title: string;
  persona: Persona;
  mode: "synthetic" | "external" | "integration";
  scenario: Scenario | null;
  created_at: string;
  policy: PolicySnapshot;
  event_count: number;
  recording_kind?: "recording" | "shopping" | "firewall_fixture";
}

export interface VisibilityGap {
  code: string;
  message: string;
  event_id?: string;
}
export interface RunDetail {
  run: Run;
  events: StoredEvent[];
  gaps: VisibilityGap[];
  shopping?: ShoppingExecution;
}

export const createRunSchema = z
  .object({
    persona: personaSchema,
    policy: policySchema.omit({ firewall: true }).optional(),
  })
  .strict();
export const demoSchema = z
  .object({
    persona: personaSchema,
    scenario: scenarioSchema.default("deviation"),
  })
  .strict();
export const eventBatchSchema = z
  .object({ events: z.array(z.unknown()).min(1).max(100) })
  .strict();

export function defaultPolicy(persona: Persona): PolicySnapshot {
  return {
    version: "v1",
    owner_id: "local_buyer",
    max_total_minor: persona === "consumer" ? 15000 : 100000,
    currency: "USD",
    merchant_ids: [
      persona === "consumer" ? "approved_sports" : "preferred_office",
    ],
    max_quantity: persona === "consumer" ? 1 : 5,
    approval_required: persona === "business",
  };
}
