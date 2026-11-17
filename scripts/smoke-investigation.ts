import { loadEnvConfig } from "@next/env";
import { BlackBoxStore } from "../src/server/store";
import { investigate, replay } from "../src/server/investigation/service";
import { assembleEvidence } from "../src/server/investigation/evidence";
loadEnvConfig(process.cwd());
void (async () => {
  const original = globalThis.fetch;
  let prohibited = 0,
    ollama = 0;
  globalThis.fetch = async (input, init) => {
    const u = new URL(String(input));
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
      !["/api/tags", "/api/show", "/api/chat"].includes(u.pathname)
    ) {
      prohibited++;
      throw new Error("Prohibited network in investigation smoke");
    }
    ollama++;
    return original(input, init);
  };
  try {
    for (const [file, id] of [
      ["phase3-smoke.sqlite", "run_eb819273-4233-4577-9157-e6f7f8369ee2"],
      ["phase4-sandbox.sqlite", "run_4bfd040d-95f4-4725-b783-b012d2090356"],
      ["phase3-smoke.sqlite", "run_d2d424e7-9836-44b9-863f-cd509af95341"],
    ]) {
      const s = new BlackBoxStore("data/" + file);
      try {
        const e = assembleEvidence(s, id),
          r = await investigate(s, id);
        const p = s.getShopping(id).firewall!.proposals[0];
        const before = ollama;
        const simulation = replay(s, {
          run_id: id,
          proposal_id: p.proposal_id,
          alternative: { quantity_mismatch: "DENY" },
        });
        if (ollama !== before) throw new Error("Replay attempted network");
        console.log(
          JSON.stringify({
            run_id: id,
            status: e.status,
            evidence_mode: e.mode,
            severity: e.severity,
            report_outcome: r.outcome,
            error_code: r.error_code,
            baseline: simulation.comparison.baseline.outcome,
            hypothetical: simulation.comparison.replayed.outcome,
            baseline_matches: simulation.comparison.baseline_matches_recorded,
            prohibited_calls: prohibited,
            replay_network_calls: ollama - before,
          }),
        );
        if (r.outcome !== "accepted" || prohibited) process.exitCode = 1;
      } finally {
        s.close();
      }
    }
  } finally {
    globalThis.fetch = original;
  }
})().catch(() => {
  console.log("Investigation smoke failed; no financial operations available");
  process.exitCode = 1;
});
