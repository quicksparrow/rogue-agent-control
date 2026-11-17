import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BlackBoxStore } from "./store";
import { createFirewallScenario } from "./firewall/scenarios";
import { assembleEvidence } from "./investigation/evidence";
import { replay } from "./investigation/replay-service";
import { visibilityGaps } from "../lib/evidence";
import type { RunDetail, Run, StoredEvent } from "../lib/contracts";
import type { DemoSnapshot } from "../lib/demo-contracts";
const archives = {
  quantity: ["phase3-smoke.sqlite", "run_eb819273-4233-4577-9157-e6f7f8369ee2"],
  authorized: [
    "phase4-sandbox.sqlite",
    "run_4bfd040d-95f4-4725-b783-b012d2090356",
  ],
  violation: [
    "phase3-smoke.sqlite",
    "run_d2d424e7-9836-44b9-863f-cd509af95341",
  ],
} as const;
const cache = new Map<string, DemoSnapshot>();
/** No provider calls. Archive connections never migrate or write. */
export function demoSnapshot(
  scenario: DemoSnapshot["scenario"],
  root = process.cwd(),
): DemoSnapshot {
  if (scenario !== "practice") {
    const [file, id] = archives[scenario];
    const path = resolve(root, "data", file);
    if (existsSync(path)) {
      let db: Database.Database | undefined;
      try {
        db = new Database(path, { readonly: true, fileMustExist: true });
        db.pragma("query_only = ON");
        const row = db.prepare("SELECT * FROM runs WHERE run_id=?").get(id) as
          | {
              trace_id: string;
              title: string;
              persona: Run["persona"];
              mode: Run["mode"];
              scenario: Run["scenario"];
              created_at: string;
              policy_json: string;
              execution_kind: string;
            }
          | undefined;
        if (!row) throw new Error("Missing archived run");
        const events = (
          db
            .prepare(
              "SELECT event_json FROM events WHERE run_id=? ORDER BY sequence",
            )
            .all(id) as { event_json: string }[]
        ).map((r) => JSON.parse(r.event_json) as StoredEvent);
        const run: Run = {
          run_id: id,
          trace_id: row.trace_id,
          title: row.title,
          persona: row.persona,
          mode:
            row.execution_kind === "shopping"
              ? "integration"
              : row.execution_kind === "firewall_fixture"
                ? "synthetic"
                : row.mode,
          scenario: row.scenario,
          created_at: row.created_at,
          policy: JSON.parse(row.policy_json),
          event_count: events.length,
          recording_kind: row.execution_kind as Run["recording_kind"],
        };
        const detail: RunDetail = {
          run,
          events,
          gaps: visibilityGaps(run, events),
        };
        const facade = { detail: () => detail } as unknown as BlackBoxStore;
        const records = (
          db
            .prepare(
              "SELECT record_json FROM investigation_artifacts WHERE run_id=? ORDER BY rowid DESC",
            )
            .all(id) as { record_json: string }[]
        ).map((r) => JSON.parse(r.record_json));
        const report = records.find(
            (r) => r.kind === "report" && r.outcome === "accepted",
          ),
          simulation = records.find((r) => r.kind === "replay");
        return {
          scenario,
          available: true,
          source: "private_readonly_archive",
          notice: `Archived ${run.mode === "synthetic" ? "synthetic" : "genuine"} recording. Read-only local viewer; not a new execution. Separate historical runs are never combined. Private records are not bundled for distribution.`,
          detail,
          evidence: assembleEvidence(facade, id),
          ...(report
            ? {
                report: {
                  report: report.report,
                  evidence_snapshot: report.evidence_snapshot,
                },
              }
            : {}),
          ...(simulation ? { comparison: simulation.comparison } : {}),
        };
      } catch {
        return {
          scenario,
          available: false,
          source: "unavailable",
          notice:
            "Archive is missing required records or is incompatible. No substitute was used. Original database was not modified.",
        };
      } finally {
        db?.close();
      }
    }
    if (scenario !== "violation")
      return {
        scenario,
        available: false,
        source: "unavailable",
        notice:
          "Genuine private recording unavailable in this checkout. No simulated evidence has been substituted. Use the separately labeled synthetic exercises.",
      };
  }
  const key = root + scenario;
  if (cache.has(key)) return cache.get(key)!;
  const store = new BlackBoxStore(":memory:");
  try {
    const result = createFirewallScenario(
        store,
        scenario === "practice" ? "quantity_mismatch" : "over_budget",
      ),
      detail = store.detail(result.run.run_id);
    const comparison = replay(store, {
      run_id: result.run.run_id,
      proposal_id: result.proposal.proposal_id,
      alternative: { quantity_mismatch: "DENY" },
    }).comparison;
    const snapshot: DemoSnapshot = {
      scenario,
      available: true,
      source: "isolated_synthetic",
      notice:
        "Generated synthetic exercise in isolated memory. Real deterministic Firewall; no model, external catalog or payment called. Nothing is written to historical databases.",
      detail,
      evidence: assembleEvidence(store, result.run.run_id),
      comparison,
    };
    cache.set(key, snapshot);
    return snapshot;
  } finally {
    store.close();
  }
}
