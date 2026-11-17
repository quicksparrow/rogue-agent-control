import { randomUUID } from "node:crypto";
import type { BlackBoxStore } from "../store";
import { StoreError } from "../store";
import { assembleEvidence, digest } from "./evidence";
import { comparePolicy } from "./replay";
import { replayRequest } from "../../lib/investigation-contracts";
import {
  ownerPolicySchema,
  type ActionRecord,
  type FirewallDecision,
} from "../../lib/firewall-contracts";
import type { EvaluationContext } from "../firewall/engine";
function save<T extends object>(
  store: BlackBoxStore,
  runId: string,
  kind: "replay",
  body: T,
) {
  const record = {
    id: `replay_${randomUUID()}`,
    run_id: runId,
    created_at: new Date().toISOString(),
    ...body,
  };
  store.db
    .prepare("INSERT INTO investigation_artifacts VALUES(?,?,?,?)")
    .run(record.id, runId, kind, JSON.stringify(record));
  return record;
}
export function replay(store: BlackBoxStore, raw: unknown) {
  const input = replayRequest.parse(raw),
    detail = store.detail(input.run_id);
  const row = store.db
    .prepare(
      "SELECT record_json FROM firewall_proposals WHERE proposal_id=? AND run_id=?",
    )
    .get(input.proposal_id, input.run_id) as
    | { record_json: string }
    | undefined;
  if (!row)
    throw new StoreError(
      409,
      "No original protected proposal available. Historical research cannot acquire retrospective authorization.",
    );
  const proposal = JSON.parse(row.record_json) as ActionRecord,
    saved = detail.shopping!;
  const get = (table: string, key: string, id: string, column: string) => {
    const r = store.db
      .prepare(`SELECT ${column} value FROM ${table} WHERE ${key}=?`)
      .get(id) as { value: string } | undefined;
    if (!r) throw new StoreError(409, "Frozen replay context missing");
    return JSON.parse(r.value);
  };
  const owner = ownerPolicySchema.parse(
    get(
      "owner_policy_versions",
      "version",
      proposal.owner_policy_version,
      "policy_json",
    ),
  );
  const context: EvaluationContext = {
    mandate: saved.mandate,
    policy: saved.policy,
    owner_policy: owner,
    registry: get(
      "merchant_registries",
      "version",
      proposal.registry_version,
      "registry_json",
    ),
    products: saved.products,
    expected: {
      owner_id: proposal.owner_id,
      agent_id: proposal.agent_id,
      mandate_id: proposal.mandate_id,
      policy_id: proposal.policy_id,
      policy_version: proposal.policy_version,
      owner_policy_version: proposal.owner_policy_version,
      registry_version: proposal.registry_version,
    },
  };
  const alternative = ownerPolicySchema.parse({
    ...owner,
    ...input.alternative,
    version: `whatif_${digest([owner, input.alternative]).slice(0, 24)}`,
  });
  const recorded = saved.firewall?.decisions.find(
    (d) => d.proposal_id === proposal.proposal_id,
  ) as FirewallDecision | undefined;
  const comparison = comparePolicy(
    proposal.action,
    context,
    alternative,
    recorded,
  );
  return save(store, input.run_id, "replay", {
    kind: "replay",
    evidence_digest: assembleEvidence(store, input.run_id).digest,
    source_proposal: proposal,
    original_mandate: {
      mandate_id: saved.mandate.mandate_id,
      quantity: saved.mandate.quantity,
      budget_minor: saved.mandate.budget_minor,
      currency: saved.mandate.currency,
      merchant_ids: saved.mandate.merchant_ids,
      firewall: saved.mandate.firewall,
    },
    original_policy: saved.policy,
    original_owner_policy: owner,
    alternative_policy: alternative,
    alternative_digest: digest(alternative),
    comparison,
  });
}
