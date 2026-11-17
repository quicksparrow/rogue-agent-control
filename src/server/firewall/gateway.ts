import { randomUUID } from "node:crypto";
import { z } from "zod";
import { identifier } from "../../lib/contracts";
import {
  actionSchema,
  evaluationSchema,
  type ActionRecord,
  type FirewallDecision,
  type GatewayResult,
} from "../../lib/firewall-contracts";
import { BlackBoxStore, StoreError } from "../store";
import { localIdentity } from "../identity";
import { evaluatePolicy, type EvaluationContext } from "./engine";
import { getOwnerPolicy, getRegistry } from "./policies";
import { recordFirewallEvent } from "./trace";

function refs(proposal: ActionRecord) {
  return {
    proposal_id: proposal.proposal_id,
    mandate_id: proposal.mandate_id,
    agent_id: proposal.agent_id,
    policy_id: proposal.policy_id,
    policy_version: proposal.policy_version,
    owner_policy_version: proposal.owner_policy_version,
    registry_version: proposal.registry_version,
  };
}
export function getProposal(store: BlackBoxStore, id: string): ActionRecord {
  identifier.parse(id);
  const row = store.db
    .prepare("SELECT record_json FROM firewall_proposals WHERE proposal_id=?")
    .get(id) as { record_json: string } | undefined;
  if (!row) throw new StoreError(404, "Recorded proposal not found");
  return JSON.parse(row.record_json) as ActionRecord;
}
function storedDecision(
  store: BlackBoxStore,
  id: string,
): FirewallDecision | undefined {
  const row = store.db
    .prepare("SELECT record_json FROM firewall_decisions WHERE proposal_id=?")
    .get(id) as { record_json: string } | undefined;
  return row ? (JSON.parse(row.record_json) as FirewallDecision) : undefined;
}
function loadContext(
  store: BlackBoxStore,
  proposal: ActionRecord,
): EvaluationContext {
  const saved = store.getShopping(proposal.run_id);
  const run = store.getRun(proposal.run_id);
  const current = localIdentity();
  const event = store.db
    .prepare("SELECT event_json FROM events WHERE event_id=? AND run_id=?")
    .get(proposal.source_event_id, proposal.run_id) as
    | { event_json: string }
    | undefined;
  const source = event ? JSON.parse(event.event_json) : null;
  if (
    !run.policy.firewall ||
    run.policy.version !== saved.policy.version ||
    proposal.owner_id !== current.owner_id ||
    proposal.agent_id !== current.agent_id ||
    source?.event_type !== "recommendation_recorded" ||
    source.payload.product_id !== proposal.action.product_id ||
    source.payload.quantity !== proposal.action.quantity ||
    source.payload.unit_amount_minor !== proposal.action.unit_amount_minor ||
    source.payload.total_amount_minor !== proposal.action.total_amount_minor ||
    source.payload.currency !== proposal.action.currency ||
    source.payload.merchant_id !== proposal.action.provider_merchant_id
  )
    throw new StoreError(503, "Trusted proposal context is inconsistent");
  return {
    mandate: saved.mandate,
    policy: saved.policy,
    owner_policy: getOwnerPolicy(store, proposal.owner_policy_version),
    registry: getRegistry(store, proposal.registry_version),
    products: saved.products,
    expected: {
      owner_id: current.owner_id,
      agent_id: current.agent_id,
      mandate_id: proposal.mandate_id,
      policy_id: proposal.policy_id,
      policy_version: proposal.policy_version,
      owner_policy_version: proposal.owner_policy_version,
      registry_version: proposal.registry_version,
    },
  };
}
function eligibility(
  proposal: ActionRecord,
  decision: FirewallDecision,
): GatewayResult {
  return {
    proposal,
    decision,
    execution_eligible: decision.outcome === "ALLOW",
    state:
      decision.outcome === "DENY"
        ? "blocked"
        : decision.outcome === "REVIEW"
          ? "review_pending"
          : "eligible_no_adapter",
    payment_executed: false,
  };
}

/** Correlate a rejected request when its reference is valid; never retain its arbitrary body. */
export function recordRejectedGatewayRequest(
  store: BlackBoxStore,
  raw: unknown,
) {
  const ref = z.object({ proposal_id: identifier }).safeParse(raw);
  if (!ref.success) return;
  try {
    const proposal = getProposal(store, ref.data.proposal_id);
    recordFirewallEvent(
      store,
      proposal.run_id,
      "gateway_error",
      {
        proposal_id: proposal.proposal_id,
        code: "INVALID_GATEWAY_REQUEST",
        payment_executed: false,
      },
      "trusted_gateway",
    );
  } catch {
    /* Invalid or unavailable context cannot grant execution, even if audit storage is unavailable. */
  }
}

export function recordProposal(
  store: BlackBoxStore,
  runId: string,
  index: number,
  sourceEventId: string,
): ActionRecord {
  return store.db
    .transaction(() => {
      const prior = store.db
        .prepare(
          "SELECT record_json FROM firewall_proposals WHERE run_id=? AND recommendation_index=?",
        )
        .get(runId, index) as { record_json: string } | undefined;
      if (prior) return JSON.parse(prior.record_json) as ActionRecord;
      const saved = store.getShopping(runId),
        run = store.getRun(runId);
      if (!saved.policy.firewall || !saved.mandate.firewall)
        throw new StoreError(
          409,
          "Historical research proposals cannot be retroactively protected",
        );
      const rec = saved.recommendations[index];
      if (!rec) throw new StoreError(400, "Original recommendation not found");
      const action = actionSchema.parse({
        operation: "payment.create_order",
        product_id: rec.product.product_id,
        source_product_id: rec.product.source_product_id,
        catalog_source: rec.product.source,
        provider_merchant_id: rec.product.merchant_id,
        unit_amount_minor: rec.product.unit_amount_minor,
        total_amount_minor: rec.total_amount_minor,
        quantity: rec.quantity,
        currency: rec.product.currency,
      });
      const value: ActionRecord = {
        proposal_id: `proposal_${randomUUID()}`,
        run_id: runId,
        source_event_id: identifier.parse(sourceEventId),
        recommendation_index: z.number().int().min(0).max(1).parse(index),
        mandate_id: saved.mandate.mandate_id,
        agent_id: saved.mandate.identity.agent_id,
        owner_id: saved.mandate.identity.owner_id,
        policy_id: saved.policy.version,
        policy_version: saved.policy.version,
        ...saved.policy.firewall,
        action,
        created_at: new Date().toISOString(),
        evidence_mode:
          run.recording_kind === "firewall_fixture"
            ? "synthetic_fixture"
            : "actual_agent",
      };
      store.db
        .prepare("INSERT INTO firewall_proposals VALUES (?,?,?,?,?)")
        .run(
          value.proposal_id,
          runId,
          sourceEventId,
          index,
          JSON.stringify(value),
        );
      recordFirewallEvent(store, runId, "action_proposed", {
        ...refs(value),
        product_id: action.product_id,
        source_event_id: sourceEventId,
        operation: action.operation,
        quantity: action.quantity,
        unit_amount_minor: action.unit_amount_minor,
        total_amount_minor: action.total_amount_minor,
        currency: action.currency,
        provider_merchant_id: action.provider_merchant_id,
        evidence_mode: value.evidence_mode,
      });
      return value;
    })
    .immediate();
}

/** No client outcome, permissions, policy edits, approval or adapter parameters are accepted. */
export function authorizeProposal(
  store: BlackBoxStore,
  proposalId: string,
): GatewayResult {
  return authorizeInternal(store, proposalId, false);
}
/** Financial boundaries must call this again immediately before each external operation. */
export function requireCurrentAllowance(
  store: BlackBoxStore,
  proposalId: string,
): GatewayResult {
  const result = authorizeProposal(store, proposalId);
  if (result.decision.outcome !== "ALLOW") return result;
  if (
    evaluationSchema.parse(
      evaluatePolicy(
        result.proposal.action,
        loadContext(store, result.proposal),
      ),
    ).outcome !== "ALLOW"
  )
    throw new StoreError(
      503,
      "Trusted policy revalidation failed; execution prevented",
    );
  return result;
}
function authorizeInternal(
  store: BlackBoxStore,
  proposalId: string,
  unavailable: boolean,
): GatewayResult {
  try {
    return store.db
      .transaction(() => {
        const proposal = getProposal(store, proposalId);
        const prior = storedDecision(store, proposalId);
        if (prior) {
          if (prior.outcome === "ALLOW") {
            try {
              if (
                unavailable ||
                evaluatePolicy(proposal.action, loadContext(store, proposal))
                  .outcome !== "ALLOW"
              )
                throw new Error();
            } catch {
              throw new StoreError(
                503,
                "Current trusted policy context is unavailable; execution prevented",
              );
            }
          }
          return eligibility(proposal, prior);
        }
        recordFirewallEvent(
          store,
          proposal.run_id,
          "policy_evaluation_requested",
          refs(proposal),
        );
        let evaluation: z.infer<typeof evaluationSchema>;
        let ownerPolicyId: string | null = null;
        try {
          if (unavailable) throw new Error("test-only evaluation outage");
          const context = loadContext(store, proposal);
          ownerPolicyId = getOwnerPolicy(
            store,
            proposal.owner_policy_version,
          ).policy_id;
          evaluation = evaluationSchema.parse(
            evaluatePolicy(proposal.action, context),
          );
        } catch {
          evaluation = {
            outcome: "DENY",
            rule_ids: ["policy.binding"],
            reason_codes: ["EVALUATION_UNAVAILABLE"],
          };
        }
        const decision: FirewallDecision = {
          ...evaluation,
          decision_id: `decision_${randomUUID()}`,
          run_id: proposal.run_id,
          agent_id: proposal.agent_id,
          mandate_id: proposal.mandate_id,
          owner_id: proposal.owner_id,
          policy_id: proposal.policy_id,
          policy_version: proposal.policy_version,
          owner_policy_id: ownerPolicyId,
          owner_policy_version: proposal.owner_policy_version,
          registry_version: proposal.registry_version,
          proposal_id: proposalId,
          proposed_action_reference: proposalId,
          timestamp: new Date().toISOString(),
        };
        store.db
          .prepare("INSERT INTO firewall_decisions VALUES (?,?,?)")
          .run(decision.decision_id, proposalId, JSON.stringify(decision));
        recordFirewallEvent(
          store,
          proposal.run_id,
          "policy_decision_recorded",
          {
            ...refs(proposal),
            decision_id: decision.decision_id,
            outcome: decision.outcome,
            rule_ids: decision.rule_ids,
            reason_codes: decision.reason_codes,
          },
        );
        const result = eligibility(proposal, decision);
        recordFirewallEvent(
          store,
          proposal.run_id,
          "gateway_eligibility_recorded",
          {
            proposal_id: proposalId,
            decision_id: decision.decision_id,
            execution_eligible: result.execution_eligible,
            state: result.state,
            payment_executed: false,
          },
          "trusted_gateway",
        );
        return result;
      })
      .immediate();
  } catch (error) {
    // The decision transaction has rolled back. Preserve a safe audit event when storage still works.
    if (error instanceof StoreError && error.status === 503) {
      try {
        const proposal = getProposal(store, proposalId);
        recordFirewallEvent(
          store,
          proposal.run_id,
          "gateway_error",
          {
            proposal_id: proposalId,
            code: "EVALUATION_UNAVAILABLE",
            payment_executed: false,
          },
          "trusted_gateway",
        );
      } catch {
        /* Storage failure still prevents execution even when an error cannot be recorded. */
      }
    }
    throw error;
  }
}

export interface TestPaymentAdapter {
  readonly kind: "isolated_mock";
  execute(
    action: Readonly<ActionRecord["action"]>,
    idempotencyKey: string,
  ): Promise<void>;
}
/** The only dispatcher in Phase 3. Never used by application routes; refuses production or on-disk stores. */
export function createIsolatedMockGateway(
  store: BlackBoxStore,
  adapter: TestPaymentAdapter,
  testConfig: { isolated: true; evaluationUnavailable?: boolean },
) {
  if (
    process.env.NODE_ENV !== "test" ||
    store.db.name !== ":memory:" ||
    testConfig.isolated !== true ||
    adapter.kind !== "isolated_mock"
  )
    throw new StoreError(
      403,
      "Mock dispatch is restricted to explicit isolated in-memory tests",
    );
  return {
    async dispatch(raw: unknown): Promise<GatewayResult> {
      const input = z.object({ proposal_id: identifier }).strict().parse(raw);
      // Recheck at every dispatch, even if an instance was constructed before a mode change.
      if (process.env.NODE_ENV !== "test" || store.db.name !== ":memory:")
        throw new StoreError(403, "Mock dispatch unavailable outside tests");
      const result = authorizeInternal(
        store,
        input.proposal_id,
        Boolean(testConfig.evaluationUnavailable),
      );
      if (!result.execution_eligible) return result;
      // Independently re-evaluate stored trusted context; a historical ALLOW is never an execution capability.
      try {
        if (
          testConfig.evaluationUnavailable ||
          evaluatePolicy(
            result.proposal.action,
            loadContext(store, result.proposal),
          ).outcome !== "ALLOW"
        )
          throw new Error();
      } catch {
        recordFirewallEvent(
          store,
          result.proposal.run_id,
          "gateway_error",
          {
            proposal_id: input.proposal_id,
            code: "CONTEXT_CHANGED",
            payment_executed: false,
          },
          "trusted_gateway",
        );
        throw new StoreError(
          503,
          "Policy authorization could not be re-established; execution prevented",
        );
      }
      const claim = store.db
        .transaction(() => {
          if (
            store.db
              .prepare(
                "SELECT 1 FROM sandbox_payments WHERE run_id=? OR mandate_id=?",
              )
              .get(result.proposal.run_id, result.proposal.mandate_id)
          )
            throw new StoreError(
              409,
              "This mandate is already reserved for sandbox checkout",
            );
          const key = `gateway_${input.proposal_id}`;
          const inserted = store.db
            .prepare(
              "INSERT OR IGNORE INTO gateway_claims VALUES (?,?,?,?,'mock_executing')",
            )
            .run(
              input.proposal_id,
              key,
              result.proposal.run_id,
              result.proposal.mandate_id,
            );
          const row = store.db
            .prepare("SELECT state FROM gateway_claims WHERE proposal_id=?")
            .get(input.proposal_id) as
            | { state: GatewayResult["state"] }
            | undefined;
          if (!row)
            throw new StoreError(
              409,
              "This mandate is already reserved by another alternative; execution prevented",
            );
          if (inserted.changes)
            recordFirewallEvent(
              store,
              result.proposal.run_id,
              "gateway_test_dispatch",
              {
                proposal_id: input.proposal_id,
                decision_id: result.decision.decision_id,
                state: "mock_executing",
                test_only: true,
                payment_executed: false,
              },
              "trusted_gateway",
            );
          return { fresh: inserted.changes === 1, state: row.state, key };
        })
        .immediate();
      if (!claim.fresh) return { ...result, state: claim.state };
      let state: "mock_completed" | "mock_unknown" = "mock_completed";
      try {
        await adapter.execute(
          Object.freeze({ ...result.proposal.action }),
          claim.key,
        );
      } catch {
        state = "mock_unknown";
      }
      store.db.transaction(() => {
        store.db
          .prepare("UPDATE gateway_claims SET state=? WHERE proposal_id=?")
          .run(state, input.proposal_id);
        recordFirewallEvent(
          store,
          result.proposal.run_id,
          "gateway_test_dispatch",
          {
            proposal_id: input.proposal_id,
            decision_id: result.decision.decision_id,
            state,
            test_only: true,
            payment_executed: false,
          },
          "trusted_gateway",
        );
      })();
      return { ...result, state };
    },
  };
}
