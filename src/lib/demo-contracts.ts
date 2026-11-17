import { z } from "zod";
import type { RunDetail } from "./contracts";
import type {
  EvidencePackage,
  InvestigationReport,
} from "./investigation-contracts";
export const demoIds = [
  "quantity",
  "authorized",
  "violation",
  "practice",
] as const;
export const demoQuery = z.object({ scenario: z.enum(demoIds) }).strict();
export const demoScenarios = [
  {
    id: "quantity",
    title: "AI Quantity Deviation",
    kind: "Archived Qwen3 run",
    description:
      "Trace a proposal for one mouse against a request for ten.",
  },
  {
    id: "authorized",
    title: "Authorized Sandbox Purchase",
    kind: "Archived sandbox purchase",
    description:
      "Follow a separate authorized purchase from order creation to confirmed capture.",
  },
  {
    id: "violation",
    title: "Synthetic Policy Violation",
    kind: "Synthetic fixture",
    description: "Inspect a purchase blocked by the spending limit.",
  },
  {
    id: "practice",
    title: "Practice Quantity Controls",
    kind: "Synthetic exercise",
    description:
      "Compare a quantity mismatch under two policy settings.",
  },
] as const;
export interface DemoSnapshot {
  scenario: (typeof demoIds)[number];
  available: boolean;
  source: "private_readonly_archive" | "isolated_synthetic" | "unavailable";
  notice: string;
  detail?: RunDetail;
  evidence?: EvidencePackage;
  report?: { report: InvestigationReport; evidence_snapshot: EvidencePackage };
  comparison?: {
    baseline: { outcome: string; reason_codes: string[] };
    replayed: { outcome: string; reason_codes: string[] };
    baseline_matches_recorded: boolean | null;
    changed_fields: string[];
  };
}
