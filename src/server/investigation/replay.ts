// Pure evaluation only: no gateway, adapters, network, environment or mutable claims.
import { evaluatePolicy, type EvaluationContext } from "../firewall/engine";
import { ownerPolicySchema } from "../../lib/firewall-contracts";
import type { ProposedAction, Evaluation } from "../../lib/firewall-contracts";
export function comparePolicy(
  action: ProposedAction,
  context: EvaluationContext,
  alternative: unknown,
  recorded?: Evaluation,
) {
  const original = ownerPolicySchema.parse(context.owner_policy),
    alt = ownerPolicySchema.parse(alternative);
  if (
    alt.owner_id !== original.owner_id ||
    alt.registry_version !== original.registry_version ||
    alt.persona !== original.persona
  )
    throw new Error("Alternative ownership/registry mismatch");
  const baseline = evaluatePolicy(action, context);
  const m = context.mandate as Record<string, unknown>,
    p = context.policy as Record<string, unknown>;
  const binding = {
    owner_policy_version: alt.version,
    registry_version: alt.registry_version,
  };
  const hypothetical = {
    ...context,
    mandate: { ...m, firewall: binding },
    policy: { ...p, firewall: binding },
    owner_policy: alt,
    expected: { ...context.expected, owner_policy_version: alt.version },
  };
  const replayed = evaluatePolicy(action, hypothetical);
  const fields = Object.keys(original).filter(
    (k) => !["version", "parent_version", "created_at", "revision"].includes(k),
  ) as (keyof typeof original)[];
  return {
    baseline,
    replayed,
    recorded: recorded ?? null,
    baseline_matches_recorded: recorded
      ? JSON.stringify(baseline) ===
        JSON.stringify({
          outcome: recorded.outcome,
          rule_ids: recorded.rule_ids,
          reason_codes: recorded.reason_codes,
        })
      : null,
    changed_fields: fields.filter(
      (k) => JSON.stringify(original[k]) !== JSON.stringify(alt[k]),
    ),
    added_reason_codes: replayed.reason_codes.filter(
      (c) => !baseline.reason_codes.includes(c),
    ),
    removed_reason_codes: baseline.reason_codes.filter(
      (c) => !replayed.reason_codes.includes(c),
    ),
    simulation: true as const,
    execution_authorized: false as const,
    network_calls: 0,
  };
}
