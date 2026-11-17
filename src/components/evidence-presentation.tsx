import { Link2, ScanLine, Layers3 } from "lucide-react";
import type { ReactNode } from "react";
import type { EvidencePackage } from "../lib/investigation-contracts";

export function eventSequences(index: unknown[] = []) {
  const sequences = new Map<string, number>();
  for (const entry of index) {
    if (entry && typeof entry === "object" && "event_id" in entry && "sequence" in entry
        && typeof entry.event_id === "string" && typeof entry.sequence === "number") {
      sequences.set(entry.event_id, entry.sequence);
    }
  }
  return sequences;
}

export function Citations({ ids, sequences, run, onSelect }: {
  ids: string[];
  sequences: Map<string, number>;
  run: string;
  onSelect?: (id: string) => void;
}) {
  return <span className="investigation-citations">{[...new Set(ids)].map(id => {
    const sequence = sequences.get(id);
    const content = <><Link2 size={13} aria-hidden="true" />{sequence === undefined ? id : `Event #${sequence}`}</>;
    return onSelect
      ? <button key={id} className="citation-button" type="button" title={id} onClick={() => onSelect(id)}>{content}</button>
      : <a key={id} className="citation-link" title={id} href={`/?run=${encodeURIComponent(run)}&event=${encodeURIComponent(id)}`}>{content}</a>;
  })}</span>;
}

export function CaseSummary({ evidence }: { evidence: EvidencePackage }) {
  return <div className="case-summary" role="status">
    <dl>
      <div><dt>Classification</dt><dd><ScanLine aria-hidden="true" size={16} />{evidence.status.replaceAll("_"," ")}</dd></div>
      <div><dt>Severity:</dt><dd className={`severity severity-${evidence.severity}`}>{evidence.severity}</dd></div>
      <div><dt>Evidence source</dt><dd>{evidence.mode === "synthetic" ? "Synthetic fixture" : evidence.mode === "integration" ? "Integration recording" : evidence.mode}</dd></div>
      <div><dt>Recorded events</dt><dd className="mono">{evidence.event_count}</dd></div>
    </dl>
  </div>;
}

export type Comparison = {
  baseline: { outcome: string; reason_codes: string[] };
  replayed: { outcome: string; reason_codes: string[] };
  baseline_matches_recorded: boolean | null;
  changed_fields: string[];
};

export function ReplayTable({ result, constraints }: { result: Comparison; constraints?: ReactNode }) {
  return <>
    <div className="replay-table" tabIndex={0} role="region" aria-label="Original and hypothetical policy comparison"><table>
      <thead><tr><th scope="col">Comparison</th><th scope="col">Original policy</th><th scope="col"><Layers3 size={13} aria-hidden="true" /> What-if simulation</th></tr></thead>
      <tbody>
        <tr><th scope="row">Firewall decision</th>
          {[result.baseline, result.replayed].map((decision, i) => <td key={i}><span className="replay-outcome" data-outcome={decision.outcome}>{decision.outcome}</span></td>)}
        </tr>
        {constraints}
        <tr><th scope="row">Reason codes</th>
          {[result.baseline, result.replayed].map((decision,i) => <td key={i}>{decision.reason_codes.map(code => <code className="reason-code" key={code}>{code}</code>)}</td>)}
        </tr>
        <tr><th scope="row">Payment authority from replay</th><td>None</td><td>None</td></tr>
      </tbody>
    </table></div>
    <p className="comparison-verdict" data-match={String(result.baseline_matches_recorded)}>
      Baseline matches recorded decision: {result.baseline_matches_recorded === null ? "no recorded decision" : String(result.baseline_matches_recorded)}
    </p>
    <p className="comparison-diff">Changed rules: <code>{result.changed_fields.join(", ") || "none"}</code>. The proposal and historical payment record are unchanged.</p>
  </>;
}
