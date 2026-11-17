import { createHash } from "node:crypto";
import type { BlackBoxStore } from "../store";
import type { EvidencePackage, Fact } from "../../lib/investigation-contracts";
export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function assembleEvidence(
  store: BlackBoxStore,
  runId: string,
): EvidencePackage {
  const detail = store.detail(runId),
    { run, events } = detail;
  const facts: Fact[] = [];
  const add = (
    kind: Fact["kind"],
    text: string,
    event_ids: string[],
    provenance: string,
    rule_ids: string[] = [],
  ) => {
    facts.push({
      id: `fact_${digest([kind, text, event_ids]).slice(0, 20)}`,
      kind,
      text,
      event_ids,
      provenance,
      rule_ids,
    });
  };
  for (const e of events) {
    const p = e.payload,
      provenance = `${e.provenance.mode}/${e.provenance.source}/${e.provenance.trusted ? "application-owned" : "content-untrusted"}`;
    if (
      e.event_type === "mandate_captured" ||
      e.event_type === "mandate_recorded"
    )
      add(
        "observation",
        `Original mandate: quantity ${p.quantity ?? run.policy.max_quantity}; budget ${p.max_total_minor} ${p.currency} minor units.`,
        [e.event_id],
        provenance,
      );
    if (
      e.event_type === "recommendation_recorded" ||
      e.event_type === "purchase_proposed"
    ) {
      add(
        "observation",
        `Recorded proposal: quantity ${p.quantity}; total ${p.total_amount_minor} ${p.currency} minor units.`,
        [e.event_id],
        provenance,
      );
      const requested =
        detail.shopping?.mandate.quantity ?? run.policy.max_quantity;
      if (p.quantity !== requested)
        add(
          "deviation",
          `Requested quantity ${requested}; proposed quantity ${p.quantity}. Original proposal retained.`,
          [e.event_id],
          provenance,
          ["quantity.mandate"],
        );
      if (Number(p.total_amount_minor) > run.policy.max_total_minor)
        add(
          "deviation",
          `Proposed ${p.total_amount_minor} exceeds original ${run.policy.max_total_minor} minor-unit budget.`,
          [e.event_id],
          provenance,
          ["budget.transaction"],
        );
    }
    if (e.event_type === "policy_decision_recorded")
      add(
        p.outcome === "DENY"
          ? "policy_violation"
          : p.outcome === "REVIEW"
            ? "review"
            : "observation",
        `Firewall ${p.outcome}: ${(p.reason_codes as string[]).join(", ")}.`,
        [e.event_id],
        provenance,
        p.rule_ids as string[],
      );
    if (e.event_type === "gateway_error")
      add(
        "blocked",
        `Gateway prevented execution: ${p.code}.`,
        [e.event_id],
        provenance,
      );
    if (e.event_type === "payment_state_changed")
      add(
        p.state === "unknown_reconciling" ? "gap" : "observation",
        `Sandbox state ${p.state}; order ${p.provider_status ?? "not observed"}; capture ${p.capture_status ?? "not recorded"}. No real money or retailer fulfillment.`,
        [e.event_id],
        provenance,
      );
    if (e.event_type === "model_completed")
      add(
        "observation",
        `Model step ${p.step}: ${p.outcome}. Thinking omitted.`,
        [e.event_id],
        provenance,
      );
    if (e.event_type === "catalog_received")
      add(
        "observation",
        `Catalog ${p.catalog_mode}: ${p.result_count} captured offers; content untrusted.`,
        [e.event_id],
        provenance,
      );
  }
  const last = events
    .filter((e) => e.event_type === "payment_state_changed")
    .at(-1);
  const hasProblem = facts.some((f) =>
    ["deviation", "policy_violation", "review", "blocked"].includes(f.kind),
  );
  if (
    last?.payload.state === "captured" &&
    last.payload.capture_status === "COMPLETED" &&
    !hasProblem &&
    events.some(
      (e) =>
        e.event_type === "policy_decision_recorded" &&
        e.payload.outcome === "ALLOW",
    ) &&
    events.some(
      (e) =>
        e.event_type === "payment_state_changed" &&
        e.payload.state === "buyer_approved",
    )
  )
    add(
      "authorized",
      "Recorded ALLOW, server-observed buyer approval and confirmed sandbox capture establish an authorized sandbox execution.",
      [
        last.event_id,
        events.find(
          (e) =>
            e.event_type === "policy_decision_recorded" &&
            e.payload.outcome === "ALLOW",
        )!.event_id,
        events.find(
          (e) =>
            e.event_type === "payment_state_changed" &&
            e.payload.state === "buyer_approved",
        )!.event_id,
      ],
      "integration/application-derived",
    );
  for (const gap of detail.gaps.filter(
    (g) =>
      !g.code.endsWith("scope") &&
      ![
        "payment_not_observed",
        "controlled_policy_fixture",
        "synthetic_only",
        "unverified_source",
      ].includes(g.code),
  ))
    add(
      "gap",
      `Visibility gap: ${gap.code}. No missing action is inferred.`,
      gap.event_id ? [gap.event_id] : events.slice(0, 1).map((e) => e.event_id),
      "application-diagnostic",
    );
  const unresolved = last?.payload.state === "unknown_reconciling";
  const authorized = facts.some((f) => f.kind === "authorized");
  const status =
    hasProblem || unresolved
      ? "incident"
      : authorized
        ? "authorized_execution"
        : !events.length
          ? "insufficient_evidence"
          : "observed_execution";
  const severity = unresolved
    ? "high"
    : hasProblem
      ? "medium"
      : facts.some((f) => f.kind === "gap")
        ? "low"
        : "none";
  const limitations = [
    "Facts describe stored observations, not private reasoning or proven causality.",
    "Synthetic and external claims are not actual model or verified payment evidence.",
    "No payment or shopping tool is executed by investigation or replay.",
  ];
  if (facts.length > 160)
    limitations.push(
      "Fact package truncated to 160 observations; inspect the full original Black Box.",
    );
  const base = {
    version: "investigation_v1" as const,
    run_id: runId,
    trace_id: run.trace_id,
    mode: run.mode,
    facts:
      facts.length > 160
        ? [
            ...facts.filter((f) => f.kind !== "observation"),
            ...facts.filter((f) => f.kind === "observation"),
          ].slice(0, 160)
        : facts,
    severity,
    status,
    event_count: events.length,
    limitations,
    references: {
      policy_version: run.policy.version,
      owner_policy_version: run.policy.firewall?.owner_policy_version ?? null,
      registry_version: run.policy.firewall?.registry_version ?? null,
      mandate_id: detail.shopping?.mandate.mandate_id ?? null,
      requested_quantity:
        detail.shopping?.mandate.quantity ?? run.policy.max_quantity,
      currency: run.policy.currency,
      budget_minor: run.policy.max_total_minor,
    },
    event_index: events.slice(0, 256).map((e) => ({
      event_id: e.event_id,
      timestamp: e.timestamp,
      sequence: e.sequence,
      parent_event_id: e.parent_event_id,
      event_type: e.event_type,
      provenance: e.provenance,
    })),
  };
  return {
    ...base,
    digest: digest({
      base,
      events: events.map((e) => [
        e.event_id,
        e.sequence,
        e.timestamp,
        e.provenance,
      ]),
      policy: run.policy,
    }),
  } as EvidencePackage;
}
