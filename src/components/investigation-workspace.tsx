"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, FlaskConical, FolderOpen, Info } from "lucide-react";
import { hypothesisText, type EvidencePackage, type Fact, type InvestigationReport } from "../lib/investigation-contracts";
import type { ShoppingExecution } from "../lib/shopping-contracts";
import WorkspaceSidebar from "./workspace-sidebar";
import { CaseSummary, Citations, ReplayTable, eventSequences, type Comparison } from "./evidence-presentation";

type Artifact = {
  id: string;
  kind: string;
  outcome?: string;
  error_code?: string;
  report?: InvestigationReport;
  evidence_snapshot?: EvidencePackage;
  comparison?: Comparison;
  alternative_policy?: { version: string; quantity_mismatch: string };
  original_owner_policy?: { version: string; quantity_mismatch: string };
  original_mandate?: { quantity: number };
  source_proposal?: { proposal_id: string; action: { quantity: number } };
};
type CaseFile = { evidence: EvidencePackage; artifacts: Artifact[]; execution: ShoppingExecution | null };
const kindLabels: Record<Fact["kind"],string> = {
  observation: "Recorded observation", deviation: "Observed deviation", policy_violation: "Policy violation",
  blocked: "Blocked action", review: "Review required", gap: "Missing evidence", authorized: "Authorized execution",
};

function ReportBody({ report, evidence }: { report: InvestigationReport; evidence: EvidencePackage }) {
  const sequences = eventSequences(evidence.event_index);
  const facts = new Map(evidence.facts.map(f => [f.id, f]));
  const entries = (items: InvestigationReport["summary"]) => items.map((item,i) => <div className="report-entry" key={i}>
    <p>{facts.get(item.fact_id)?.text}</p>
    <Citations ids={item.event_ids} sequences={sequences} run={evidence.run_id} />
  </div>);
  return <div className="report-body">
    <h3>Executive summary</h3>{entries(report.summary)}
    <h3>Observed facts</h3>{entries(report.observed_facts)}
    <h3>Policy findings</h3>{report.policy_findings.length ? entries(report.policy_findings) : <p>No policy finding cited in this report.</p>}
    <div className="report-hypotheses"><h3>Possible contributing factors</h3>
      {report.hypotheses.length ? report.hypotheses.map((h,i) => <div className="report-entry" key={i}><p>{hypothesisText[h.code]}</p>
        <Citations run={evidence.run_id} sequences={sequences} ids={h.fact_ids.flatMap(id => facts.get(id)?.event_ids ?? [])} /></div>) : <p>No hypothesis recorded.</p>}
    </div>
    <h3>Recommendations</h3><ul>{report.recommendations.map(c => <li key={c}>{c.replaceAll("_"," ")}</li>)}</ul>
    <p className="section-description">Model advisory severity: {report.advisory_severity}. Application severity: {evidence.severity}.</p>
  </div>;
}

export default function InvestigationWorkspace() {
  const [run, setRun] = useState("");
  const [data, setData] = useState<CaseFile>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"report" | "replay" | null>(null);
  const busy = useRef(false);
  const [ready, setReady] = useState(false);
  const [proposal, setProposal] = useState("");
  const [mismatch, setMismatch] = useState("DENY");

  async function load(id: string, signal?: AbortSignal) {
    const response = await fetch(`/api/investigation?run_id=${encodeURIComponent(id)}`, {signal});
    if (!response.ok) throw Error();
    const body: CaseFile = await response.json();
    if (signal?.aborted) return;
    setData(body);
    setProposal(current => current || body.execution?.firewall?.proposals[0]?.proposal_id || "");
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("run") ?? "";
    const controller = new AbortController();
    setRun(id);
    if (id) void load(id,controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("This investigation could not be loaded. Open the recording in Black Box to inspect the evidence.");
    }).finally(() => { if (!controller.signal.aborted) setReady(true); });
    else setReady(true);
    return () => controller.abort();
  }, []);

  async function action(kind: "report" | "replay") {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setError("");
    try {
      const response = await fetch(kind === "report" ? "/api/investigation" : "/api/replay", {
        method:"POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify(kind === "report" ? {run_id:run} : {run_id:run, proposal_id:proposal, alternative:{quantity_mismatch:mismatch}}),
      });
      if (!response.ok) throw Error();
      await load(run);
    } catch {
      setError("The request could not be completed. Reopen this run to check its saved artifacts.");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  const sequences = eventSequences(data?.evidence.event_index);
  const factRows = (facts: Fact[]) => facts.map(f => <article className="case-fact" key={f.id}>
    <div className="fact-descriptor"><strong data-kind={f.kind}>{kindLabels[f.kind]}</strong><small>{f.provenance}</small></div>
    <div><p>{f.text}</p>{f.rule_ids.length > 0 && <p className="fact-rules">{f.rule_ids.map(id => <code key={id}>{id}</code>)}</p>}
      <Citations ids={f.event_ids} sequences={sequences} run={run} /></div>
  </article>);
  const report = data?.artifacts.find(a => a.kind === "report");
  const replay = data?.artifacts.find(a => a.kind === "replay" && a.source_proposal?.proposal_id === proposal);
  const proposals = data?.execution?.firewall?.proposals ?? [];
  const recorded = data?.evidence.facts.filter(f => f.kind === "observation") ?? [];
  const findings = data?.evidence.facts.filter(f => f.kind !== "observation") ?? [];
  return <div className="app-shell">
    <a href="#investigate-main" className="skip-link">Skip to investigation</a>
    <WorkspaceSidebar active="investigate" />
    <div className="workspace"><main className="investigation-main" id="investigate-main" tabIndex={-1}>
      <header className="page-heading"><div><span className="eyebrow">Black Box</span><h1>Run investigation</h1>
        <p>Review recorded behavior, trace findings to evidence, and compare policy decisions.</p>
      </div><a className="button secondary" href={run ? `/?run=${encodeURIComponent(run)}` : "/"}><ArrowLeft size={15} />Open Black Box</a></header>
      {error && <p className="case-error" role="alert">{error}</p>}
      {!ready && <p role="status" className="case-notice">Loading run evidence…</p>}
      {ready && !data && !error && <section className="case-empty"><FolderOpen size={32} /><h2>Select a recording</h2><p>Open Black Box, select a run, then choose Investigate to review its evidence.</p></section>}
      {data && <>
        <section className="case-panel case-overview"><h2>Incident overview</h2><CaseSummary evidence={data.evidence} />
          <details className="snapshot-meta"><summary>Run and evidence snapshot</summary><dl><dt>Run</dt><dd>{run}</dd><dt>Snapshot digest</dt><dd>{data.evidence.digest}</dd></dl></details>
        </section>
        <nav className="case-nav" aria-label="Investigation sections">
          <a href="#case-behavior">Observed behavior</a><a href="#case-findings">Policy findings</a>
          <a href="#case-report">AI investigation</a><a href="#case-replay">Policy replay</a>
        </nav>
        <section className="case-panel" id="case-behavior"><h2>Observed behavior</h2>
          {factRows(recorded.filter(f=> f.text.startsWith("Original mandate") || f.text.startsWith("Recorded proposal")))}
          <details className="observation-details"><summary>Other recorded observations ({recorded.filter(f=> !(f.text.startsWith("Original mandate") || f.text.startsWith("Recorded proposal"))).length})</summary>
            {factRows(recorded.filter(f=> !(f.text.startsWith("Original mandate") || f.text.startsWith("Recorded proposal"))))}</details>
        </section>
        <section className="case-panel" id="case-findings"><h2>Policy findings</h2>
          <p className="section-description">Determined from the recorded mandate, proposal and control decisions.</p>
          {findings.length ? factRows(findings) : <p>No deviations or gaps identified in this evidence package.</p>}
        </section>
        <section className="case-panel" id="case-report"><div className="analysis-heading"><div><span className="section-label"><BookOpen size={14} />Local model</span><h2>AI investigation</h2></div>
          <button className="button primary" disabled={!!pending} onClick={() => void action("report")}>{pending === "report" ? "Generating report…" : "Generate Qwen3 report"}</button></div>
          <p className="section-description">Qwen3 selects verified observations and links each finding to its sources.</p>
          {report && <><p className="report-status" role="status" data-outcome={report.outcome}>Report outcome: {report.outcome} {report.error_code && <code>{report.error_code}</code>}</p>
            {report.report && report.evidence_snapshot && <ReportBody report={report.report} evidence={report.evidence_snapshot} />}</>}
        </section>
        <section className="case-panel uncertainty"><h2><Info size={17} />Uncertainty and limitations</h2><ul>{data.evidence.limitations.map(t=><li key={t}>{t}</li>)}</ul></section>
        <section className="case-panel" id="case-replay"><span className="section-label"><FlaskConical size={14}/>Policy simulation</span><h2>Deterministic replay</h2>
          <p className="simulation-note">Hypothetical simulation. No executable authorization.</p>
          <div className="replay-form"><label className="shopping-field">Recorded proposal<select value={proposal} disabled={!proposals.length || !!pending} onChange={e=>setProposal(e.target.value)}>
            {!proposals.length && <option value="">No frozen proposal available</option>}
            {proposals.map(p=><option key={p.proposal_id} value={p.proposal_id}>{p.proposal_id}</option>)}</select></label>
            <label className="shopping-field">What-if quantity mismatch rule<select value={mismatch} disabled={!proposals.length || !!pending} onChange={e=>setMismatch(e.target.value)}>
              <option value="DENY">DENY (strict quantity)</option><option value="REVIEW">REVIEW (pause for review)</option></select></label>
          </div><button className="button primary" disabled={!!pending || !proposal} onClick={()=>void action("replay")}>{pending === "replay" ? "Comparing policies…" : "Compare policies without execution"}</button>
          {!proposals.length && <p className="section-description">Replay requires a proposal recorded under a frozen policy.</p>}
          {replay?.comparison && <ReplayTable result={replay.comparison} constraints={<>
            <tr><th scope="row">Requested quantity</th><td>{replay.original_mandate?.quantity}</td><td>{replay.original_mandate?.quantity}</td></tr>
            <tr><th scope="row">Proposed quantity</th><td>{replay.source_proposal?.action.quantity}</td><td>{replay.source_proposal?.action.quantity}</td></tr>
            <tr><th scope="row">Policy version</th><td><code>{replay.original_owner_policy?.version}</code></td><td><code>{replay.alternative_policy?.version}</code></td></tr>
            <tr><th scope="row">Quantity mismatch rule</th><td>{replay.original_owner_policy?.quantity_mismatch}</td><td>{replay.alternative_policy?.quantity_mismatch}</td></tr>
          </>} />}
        </section>
        <details className="case-history"><summary>Historical investigation artifacts ({data.artifacts.length})</summary>
          {data.artifacts.map(a=><p key={a.id}>{a.kind} · <code>{a.id}</code> · {a.outcome ?? "simulation"}</p>)}</details>
      </>}
    </main></div>
  </div>;
}
