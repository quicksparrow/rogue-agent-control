import { z } from "zod";
import { identifier } from "./contracts";
export const investigationRequest = z.object({ run_id: identifier }).strict();
export const replayRequest = z
  .object({
    run_id: identifier,
    proposal_id: identifier,
    alternative: z
      .object({
        quantity_mismatch: z.enum(["DENY", "REVIEW"]),
        require_human_approval: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export interface Fact {
  id: string;
  kind:
    | "observation"
    | "deviation"
    | "policy_violation"
    | "blocked"
    | "review"
    | "gap"
    | "authorized";
  text: string;
  event_ids: string[];
  provenance: string;
  rule_ids: string[];
}
export interface EvidencePackage {
  version: "investigation_v1";
  digest: string;
  run_id: string;
  trace_id: string;
  mode: string;
  facts: Fact[];
  severity: "none" | "low" | "medium" | "high";
  status:
    | "authorized_execution"
    | "incident"
    | "observed_execution"
    | "insufficient_evidence";
  event_count: number;
  limitations: string[];
  references?: Record<string, unknown>;
  event_index?: unknown[];
}
const cite = z
  .object({ fact_id: identifier, event_ids: z.array(identifier).min(1).max(4) })
  .strict();
export const reportSchema = z
  .object({
    summary: z.array(cite).min(1).max(3),
    observed_facts: z.array(cite).min(1).max(8),
    policy_findings: z.array(cite).max(6),
    hypotheses: z
      .array(
        z
          .object({
            code: z.enum([
              "cause_unknown",
              "selection_may_not_follow_mandate",
              "evidence_incomplete",
            ]),
            fact_ids: z.array(identifier).min(1).max(3),
          })
          .strict(),
      )
      .max(3),
    recommendations: z
      .array(
        z.enum([
          "inspect_cited_evidence",
          "review_quantity_rule",
          "verify_merchant_mapping",
          "resolve_missing_evidence",
          "retain_authorized_record",
        ]),
      )
      .min(1)
      .max(4),
    advisory_severity: z.enum(["none", "low", "medium", "high"]),
  })
  .strict();
export type InvestigationReport = z.infer<typeof reportSchema>;
export const hypothesisText = {
  cause_unknown:
    "Hypothesis: the recorded sequence does not establish the cause of the behavior.",
  selection_may_not_follow_mandate:
    "Hypothesis: product selection may not have followed the original mandate. No private reasoning or cause is established.",
  evidence_incomplete:
    "Hypothesis: missing observations may limit the explanation; omitted actions cannot be inferred.",
};
