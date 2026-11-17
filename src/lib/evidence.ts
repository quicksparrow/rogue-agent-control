import type { Run, StoredEvent, VisibilityGap } from "./contracts";

export const eventLabels: Record<StoredEvent["event_type"], string> = {
  mandate_recorded: "Buyer authorization",
  catalog_observed: "Catalog results received",
  external_content_observed: "Untrusted listing observed",
  model_response_recorded: "Model response recorded",
  tool_call_started: "Tool request started",
  tool_call_completed: "Tool response received",
  purchase_proposed: "Purchase proposed",
  policy_evaluated: "Policy decision recorded",
  payment_status_recorded: "Payment status recorded",
  run_finished: "Recording finished",
  evidence_gap: "Evidence gap reported",
  run_created: "Shopping run created",
  mandate_captured: "Application mandate captured",
  model_invoked: "Local model invoked",
  model_completed: "Local model completed",
  tool_proposed: "Tool call proposed",
  tool_validated: "Tool arguments validated",
  catalog_requested: "Catalog request started",
  catalog_received: "Catalog response captured",
  catalog_failed: "Catalog request failed",
  product_selected: "Product selected by model",
  recommendation_recorded: "Shopping recommendation",
  execution_failed: "Shopping execution failed",
  execution_completed: "Shopping execution completed",
  action_proposed: "Action proposed to gateway",
  policy_evaluation_requested: "Policy evaluation requested",
  policy_decision_recorded: "Policy Firewall decision",
  gateway_eligibility_recorded: "Gateway execution eligibility",
  gateway_test_dispatch: "Isolated mock dispatch",
  gateway_error: "Gateway prevented execution",
  payment_claimed: "Sandbox gateway execution claim",
  paypal_oauth: "Sandbox provider authentication outcome",
  paypal_operation: "Sandbox provider operation",
  payment_state_changed: "Sandbox payment state",
};

export function money(minor: unknown, code: unknown = "USD") {
  return typeof minor === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: String(code),
      }).format(minor / 100)
    : "Unknown";
}

export function summary(event: StoredEvent): string {
  const p = event.payload;
  switch (event.event_type) {
    case "mandate_recorded":
      return `${p.intent === "running_shoes" ? "Running shoes" : "Office equipment"} · limit ${money(p.max_total_minor, p.currency)}`;
    case "catalog_observed":
      return `${p.result_count} products · ${p.catalog_mode === "offline" ? "offline catalog" : "Channel3 reported by sender"}`;
    case "external_content_observed":
      return p.fixture_code === "injected_listing_v1"
        ? "Controlled injection fixture · external content is untrusted"
        : "Clean listing fixture · external content is untrusted";
    case "model_response_recorded":
      return `${p.model} · ${p.outcome}${event.provenance.mode === "synthetic" ? " · no model called" : " · sender claim, unverified"}`;
    case "purchase_proposed":
      return `${money(p.total_amount_minor, p.currency)} · ${p.merchant_id} · quantity ${p.quantity}`;
    case "policy_evaluated":
      return `${p.decision} · ${(p.rule_codes as string[]).join(", ") || "no rule codes"}`;
    case "payment_status_recorded":
      return `${p.state}${event.provenance.mode === "synthetic" ? " · simulated status" : " · sender claim, unverified"}`;
    case "tool_call_started":
      return `${p.operation} · request ${p.request_id}`;
    case "tool_call_completed":
      return `${p.operation} · ${p.result}`;
    case "run_finished":
      return `Recording ${p.outcome} · evidence completeness assessed separately`;
    case "evidence_gap":
      return String(p.code).replaceAll("_", " ");
    case "run_created":
      return `${p.catalog_mode === "offline" ? "Seeded catalog" : "Channel3 live"} · ${p.authorized_context === "policy_controlled_proposals" ? "policy-controlled proposals" : "recommendations only"}`;
    case "mandate_captured":
      return `${money(p.max_total_minor, p.currency)} · quantity ${p.quantity} · application-owned snapshot`;
    case "model_invoked":
      return `Ollama / ${p.model} · ${p.step} · context ${p.context_length}`;
    case "model_completed":
      return `${p.step} · ${p.outcome}${p.output_tokens !== undefined ? ` · ${p.output_tokens} output tokens` : ""} · thinking omitted`;
    case "tool_proposed":
      return p.operation === "catalog.get_product"
        ? "catalog.get_product · application retrieval from model-selected ID"
        : `${p.operation} · model-generated proposal`;
    case "tool_validated":
      return `${p.operation} · ${p.query ?? p.product_id} · validated arguments`;
    case "catalog_requested":
      return p.operation === "catalog.get_product"
        ? "Read captured product snapshot · no network request"
        : `${p.operation} · ${p.catalog_mode === "offline" ? "seeded data" : "Channel3 live"}`;
    case "catalog_received":
      return `${p.result_count} products · ${p.operation === "catalog.get_product" ? "captured offer snapshot" : p.catalog_mode === "offline" ? "seeded data" : "Channel3 live"} · content untrusted`;
    case "catalog_failed":
    case "execution_failed":
      return `${String(p.error_code).replaceAll("_", " ")} · no fabricated fallback`;
    case "product_selected":
      return `${p.product_id} · quantity ${p.quantity} · model rationale: ${(p.reason_codes as string[]).join(", ")}`;
    case "recommendation_recorded":
      return `${money(p.total_amount_minor, p.currency)} estimated · ${p.merchant_id} · quantity ${p.quantity}`;
    case "execution_completed":
      return `${p.recommendation_count} alternatives · ${p.model_calls} actual model calls · ${p.tool_calls} read-only tool calls`;
    case "action_proposed":
      return `${money(p.total_amount_minor, p.currency)} · quantity ${p.quantity} · ${p.evidence_mode === "synthetic_fixture" ? "controlled synthetic proposal" : "original agent proposal"}`;
    case "policy_evaluation_requested":
      return `Original mandate and immutable policy ${p.policy_version}`;
    case "policy_decision_recorded":
      return `${p.outcome} · ${(p.reason_codes as string[]).join(", ")} · deterministic server evaluation`;
    case "gateway_eligibility_recorded":
      return `${p.state} · ${p.execution_eligible ? "policy eligibility recorded; this stage did not execute payment" : "execution prevented"}`;
    case "gateway_test_dispatch":
      return `${p.state} · isolated mock only · no payment`;
    case "gateway_error":
      return `${p.code} · execution prevented`;
    case "payment_claimed":
      return `${money(p.total_amount_minor, p.currency)} · quantity ${p.quantity} · ${p.seller_mapping_version} · sandbox simulation, no fulfillment`;
    case "paypal_oauth":
      return `${p.stage} · token contents omitted · SANDBOX PROVIDER`;
    case "paypal_operation":
      return `${p.operation} · ${p.stage} · order ${p.provider_status ?? p.error_code ?? "awaiting response"} · capture ${p.capture_status ?? "not observed"} · SANDBOX PROVIDER`;
    case "payment_state_changed":
      return `${p.state} · order ${p.provider_status ?? "not observed"} · capture ${p.capture_status ?? "not observed"} · ${p.order_id ?? "no order reference"} · NO REAL MONEY`;
  }
}

// These are observed numeric discrepancies, not a policy engine or causal analysis.
export function discrepancies(run: Run, event: StoredEvent): string[] {
  if (
    event.event_type !== "purchase_proposed" &&
    event.event_type !== "recommendation_recorded"
  )
    return [];
  const p = event.payload;
  const flags: string[] = [];
  if (p.currency !== run.policy.currency) flags.push("Currency differs");
  else if (Number(p.total_amount_minor) > run.policy.max_total_minor)
    flags.push("Above mandate budget");
  if (!run.policy.merchant_ids.includes(String(p.merchant_id)))
    flags.push("Merchant outside mandate");
  if (
    event.event_type === "recommendation_recorded" &&
    Number(p.quantity) !== run.policy.max_quantity
  )
    flags.push("Quantity differs from mandate");
  else if (Number(p.quantity) > run.policy.max_quantity)
    flags.push("Quantity above mandate");
  if (
    Number(p.unit_amount_minor) * Number(p.quantity) !==
    Number(p.total_amount_minor)
  )
    flags.push("Unit/total discrepancy");
  return flags;
}

export function visibilityGaps(
  run: Run,
  events: StoredEvent[],
): VisibilityGap[] {
  const gaps: VisibilityGap[] = [];
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const expected =
    run.recording_kind === "firewall_fixture"
      ? ([
          "run_created",
          "mandate_captured",
          "action_proposed",
          "policy_evaluation_requested",
          "policy_decision_recorded",
          "gateway_eligibility_recorded",
          "run_finished",
        ] as const)
      : run.mode === "integration"
        ? ([
            "run_created",
            "mandate_captured",
            "model_invoked",
            "model_completed",
            "catalog_received",
            "run_finished",
          ] as const)
        : ([
            "mandate_recorded",
            "catalog_observed",
            "model_response_recorded",
            "purchase_proposed",
            "run_finished",
          ] as const);
  for (const type of expected) {
    if (!events.some((e) => e.event_type === type))
      gaps.push({
        code: `absent_${type}`,
        message: `No ${eventLabels[type].toLowerCase()} event observed.`,
      });
  }
  for (const e of events) {
    const parent = e.parent_event_id ? byId.get(e.parent_event_id) : undefined;
    if (e.parent_event_id && !parent)
      gaps.push({
        code: "missing_parent",
        message: `Parent ${e.parent_event_id} is absent from this run.`,
        event_id: e.event_id,
      });
    if (parent && parent.timestamp > e.timestamp)
      gaps.push({
        code: "clock_inversion",
        message:
          "Producer timestamp precedes its parent; receipt order is preserved.",
        event_id: e.event_id,
      });
    if (parent && parent.sequence > e.sequence)
      gaps.push({
        code: "late_parent",
        message:
          "Parent arrived after its child; receipt order differs from causal links.",
        event_id: e.event_id,
      });
    if (
      e.event_type === "tool_call_started" &&
      !events.some(
        (other) =>
          other.event_type === "tool_call_completed" &&
          other.payload.request_id === e.payload.request_id &&
          other.payload.operation === e.payload.operation,
      )
    )
      gaps.push({
        code: "missing_tool_response",
        message: `No completion observed for ${e.payload.operation}.`,
        event_id: e.event_id,
      });
    if (e.event_type === "evidence_gap")
      gaps.push({
        code: String(e.payload.code),
        message: summary(e),
        event_id: e.event_id,
      });
    if (
      e.event_type === "model_invoked" &&
      !events.some(
        (other) =>
          other.event_type === "model_completed" &&
          other.payload.invocation_id === e.payload.invocation_id,
      )
    )
      gaps.push({
        code: "missing_model_completion",
        message: "No model completion was captured for this invocation.",
        event_id: e.event_id,
      });
    if (
      e.event_type === "catalog_requested" &&
      !events.some(
        (other) =>
          ["catalog_received", "catalog_failed"].includes(other.event_type) &&
          other.payload.request_id === e.payload.request_id,
      )
    )
      gaps.push({
        code: "missing_catalog_response",
        message: "Catalog request has no observed response or error.",
        event_id: e.event_id,
      });
    if (e.event_type === "execution_failed")
      gaps.push({
        code: "execution_failed",
        message: summary(e),
        event_id: e.event_id,
      });
    if (
      e.event_type === "action_proposed" &&
      !events.some(
        (other) =>
          other.event_type === "policy_decision_recorded" &&
          other.payload.proposal_id === e.payload.proposal_id,
      )
    )
      gaps.push({
        code: "missing_policy_decision",
        message:
          "The proposed action has no persisted Firewall decision. Execution is not authorized.",
        event_id: e.event_id,
      });
    if (
      e.event_type === "policy_decision_recorded" &&
      !events.some(
        (other) =>
          other.event_type === "gateway_eligibility_recorded" &&
          other.payload.decision_id === e.payload.decision_id,
      )
    )
      gaps.push({
        code: "missing_gateway_eligibility",
        message:
          "No gateway eligibility record was captured for this decision.",
        event_id: e.event_id,
      });
    if (e.event_type === "gateway_error")
      gaps.push({
        code: "gateway_prevented_execution",
        message: summary(e),
        event_id: e.event_id,
      });
    if (
      e.event_type === "paypal_operation" &&
      e.payload.stage === "requested" &&
      !events.some(
        (other) =>
          other.event_type === "paypal_operation" &&
          other.sequence > e.sequence &&
          other.payload.payment_id === e.payload.payment_id &&
          other.payload.operation === e.payload.operation &&
          other.payload.stage !== "requested",
      )
    )
      gaps.push({
        code: "missing_paypal_response",
        message:
          "No sandbox provider response or error was recorded for this operation. No successful financial outcome can be inferred.",
        event_id: e.event_id,
      });
    if (
      e.event_type === "payment_state_changed" &&
      e.payload.state === "unknown_reconciling" &&
      !events.some(
        (other) =>
          other.event_type === "payment_state_changed" &&
          other.sequence > e.sequence &&
          other.payload.payment_id === e.payload.payment_id &&
          [
            "captured",
            "buyer_approved",
            "buyer_approval_pending",
            "cancelled",
          ].includes(String(other.payload.state)),
      )
    )
      gaps.push({
        code: "payment_outcome_unknown",
        message:
          "The sandbox transaction outcome remains uncertain. Read-only reconciliation is required; capture must not be repeated.",
        event_id: e.event_id,
      });
    // A cycle can be introduced across a batch even when self-parenting is rejected.
    const seen = new Set<string>([e.event_id]);
    let cursor = parent;
    while (cursor) {
      if (seen.has(cursor.event_id)) {
        gaps.push({
          code: "parent_cycle",
          message:
            "Parent links contain a cycle; no causal order can be inferred.",
          event_id: e.event_id,
        });
        break;
      }
      seen.add(cursor.event_id);
      cursor = cursor.parent_event_id
        ? byId.get(cursor.parent_event_id)
        : undefined;
    }
  }
  if (run.recording_kind === "firewall_fixture")
    gaps.push({
      code: "controlled_policy_fixture",
      message:
        "New synthetic shopping proposal evaluated by the real deterministic Firewall. No LLM, catalog service, payment adapter or replay was used; historical recordings were not modified.",
    });
  else if (run.mode === "synthetic")
    gaps.push({
      code: "synthetic_only",
      message:
        "All events in this run are synthetic. No model, catalog service, policy gateway, or payment-provider API was called.",
    });
  else if (run.mode === "external")
    gaps.push({
      code: "unverified_source",
      message:
        "External events are sender claims. Producer identity and integration activity have not been verified.",
    });
  else if (run.policy.firewall)
    gaps.push({
      code: "policy_gateway_scope",
      message:
        "Proposals use this run's original mandate, frozen owner-policy version and server merchant mapping. ALLOW is eligibility only; sandbox checkout requires a separate claim and observed provider evidence. REVIEW remains blocked. No real money or retailer fulfillment.",
    });
  else
    gaps.push({
      code: "runtime_scope",
      message:
        "Server-instrumented research execution. Model/catalog content is untrusted; local identity comes from application configuration, not authentication. No payment, policy enforcement, or replay tools are registered.",
    });
  if (
    !events.some(
      (e) =>
        e.event_type === "policy_evaluated" ||
        e.event_type === "policy_decision_recorded",
    )
  )
    gaps.push({
      code: "policy_not_observed",
      message: run.policy.firewall
        ? "No proposed action has a recorded Firewall evaluation yet. Execution is not authorized by a status or UI label."
        : "No policy execution evidence. Reference mandate comparison does not enforce a firewall.",
    });
  if (
    !events.some(
      (e) =>
        e.event_type === "payment_status_recorded" ||
        (e.event_type === "payment_state_changed" && e.payload.order_id),
    )
  )
    gaps.push({
      code: "payment_not_observed",
      message:
        "No payment status evidence. A purchase proposal does not establish order creation or capture.",
    });
  return gaps;
}
