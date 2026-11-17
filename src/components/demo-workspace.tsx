"use client";
import { useEffect, useState } from "react";
import { demoScenarios, type DemoSnapshot } from "../lib/demo-contracts";
import { Archive, ArrowUpRight, Check, FlaskConical, LockKeyhole, PackageSearch, ScanLine, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { CaseSummary, Citations, ReplayTable, eventSequences } from "./evidence-presentation";
import { summary } from "../lib/evidence";
import EventGrid from "./event-grid";
import EvidenceInspector from "./evidence-inspector";
import WorkspaceSidebar from "./workspace-sidebar";
const scenarioIcons = { quantity: PackageSearch, authorized: ShieldCheck, violation: ScanLine, practice: SlidersHorizontal };
export default function DemoWorkspace() {
  const [scenario, setScenario] =
      useState<DemoSnapshot["scenario"]>("quantity"),
    [snapshot, setSnapshot] = useState<DemoSnapshot>(),
    [selected, setSelected] = useState<string>(),
    [query, setQuery] = useState(""),
    [source, setSource] = useState("all"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0),
    [reveal, setReveal] = useState<{eventId: string} | undefined>();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSnapshot(undefined);
    setReveal(undefined);
    setQuery("");
    setSource("all");
    fetch(`/api/demo?scenario=${scenario}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const d = await r.json();
        if (active) {
          setSnapshot(d);
          setSelected(d.detail?.events[0]?.event_id);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "This scenario could not be loaded. Try opening it again.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scenario, attempt]);
  const events = snapshot?.detail?.events ?? [],
    evidence = snapshot?.evidence;
  function cite(id: string) {
    setSelected(id);
    setReveal({eventId: id});
    setQuery("");
    setSource("all");
    document
      .getElementById("demo-grid-heading")?.focus();
  }
  const sequences = eventSequences(events);
  const citations = (ids: string[]) => <Citations ids={ids} sequences={sequences} run={snapshot?.detail?.run.run_id ?? ""} onSelect={cite} />;
  const filtered = events.filter(
    (e) =>
      (source === "all" || e.provenance.source === source) &&
      `${JSON.stringify(e)} ${summary(e)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#demo-main">
        Skip to demo
      </a>
      <WorkspaceSidebar active="demo" />
      <div className="workspace">
        <main id="demo-main" className="demo-main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                Guided demo
              </span>
              <h1>Scenario explorer</h1>
              <p>
                Explore recorded purchases, policy decisions and hypothetical outcomes.
              </p>
            </div>
            <a className="button secondary" href="/">
              Open Black Box <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
          <section className="scenario-picker" aria-label="Scenario selection"><div className="scenario-heading">
            <h2>Choose a scenario</h2><span className="read-only-label"><LockKeyhole size={13} />Read-only viewer</span></div>
          <div className="demo-choices" aria-label="Demo scenarios">
            {demoScenarios.map((s) => { const Icon = scenarioIcons[s.id]; return (
              <button
                type="button"
                key={s.id}
                className={`demo-choice ${s.id === scenario ? "selected" : ""}`}
                aria-pressed={s.id === scenario}
                onClick={() => setScenario(s.id)}
              >
                <Icon className="scenario-icon" aria-hidden="true" size={20} />
                <span className="choice-copy"><small>{s.kind}</small><strong>{s.title}</strong><span>{s.description}</span></span>
                {s.id === scenario && <Check size={16} className="choice-check" aria-hidden="true" />}
              </button>
            );})}
          </div></section>
          {loading && <p role="status">Opening preserved evidence…</p>}
          {error && <div className="case-error" role="alert">{error} <button type="button" className="button secondary" onClick={()=>setAttempt(a=>a+1)}>Retry scenario</button></div>}
          {snapshot && (
            <p className="demo-origin" role="status">
              <Archive size={15} aria-hidden="true"/><span>{snapshot.notice}</span>
            </p>
          )}
          {snapshot && !snapshot.available && (
            <section className="case-panel">
              <h2>Genuine recording unavailable</h2>
              <p>
                This scenario needs a local archive. Choose Synthetic Policy Violation or Practice Quantity Controls to explore the offline fixtures.
              </p>
            </section>
          )}
          {snapshot?.detail && evidence && (
            <>
              <nav className="demo-steps" aria-label="Guided story">
                <a href="#demo-behavior">Agent behavior</a>
                <a href="#demo-evidence">Black Box</a>
                <a href="#demo-investigation">Investigation</a>
                <a href="#demo-controls">Policy comparison</a>
              </nav>
              <section id="demo-behavior" className="case-panel">
                <span className="eyebrow">
                  Recorded behavior
                </span>
                <h2>
                  {scenario === "authorized"
                    ? "Authorized sandbox execution"
                    : scenario === "quantity"
                      ? "A genuine quantity deviation"
                      : scenario === "practice"
                        ? "Synthetic quantity exercise"
                        : "Controlled over-budget proposal"}
                </h2>
                <CaseSummary evidence={evidence} />
                <div className="behavior-facts">
                {evidence.facts
                  .filter(
                    (f) =>
                      f.text.startsWith("Original mandate") ||
                      f.text.startsWith("Recorded proposal") ||
                      f.kind === "authorized",
                  )
                  .slice(0, 4)
                  .map((f) => (
                    <article key={f.id}>
                      <p>{f.text}</p>
                      {citations(f.event_ids)}
                    </article>
                  ))}
                </div>
                {scenario === "authorized" && (
                  <>
                    <p>
                      <strong>
                        Sandbox payment record. No real money or retailer fulfillment.
                      </strong>
                    </p>
                    <div className="demo-stages">
                      {[
                        "order_created",
                        "buyer_approval_pending",
                        "buyer_approved",
                        "captured",
                      ].map((state) => {
                        const e = events.find(
                          (e) =>
                            e.event_type === "payment_state_changed" &&
                            e.payload.state === state,
                        );
                        return (
                          <article key={state}>
                            <strong>{state.replaceAll("_", " ")}</strong>
                            <p>
                              {e
                                ? `Observed order: ${e.payload.provider_status}; capture: ${e.payload.capture_status ?? "not yet recorded"}`
                                : "No observation recorded"}
                            </p>
                            {e && citations([e.event_id])}
                          </article>
                        );
                      })}
                    </div>
                    <p>
                      Historical observation only. No approval, capture or
                      reconciliation action is available in this viewer.
                    </p>
                  </>
                )}
              </section>
              <section id="demo-evidence" className="case-panel">
                <h2 tabIndex={-1} id="demo-grid-heading">Black Box evidence explorer</h2>
                <p>
                  Inspect original timestamps, sources and event links.
                </p>
                <div className="demo-filters">
                  <label>
                    Search events and IDs
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      type="search"
                    />
                  </label>
                  <label>
                    Evidence source
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="all">All sources</option>
                      {[...new Set(events.map((e) => e.provenance.source))].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <EventGrid
                  events={filtered}
                  selectedId={selected}
                  onSelect={setSelected}
                  reveal={reveal}
                />
                <EvidenceInspector
                  event={events.find((e) => e.event_id === selected)}
                  run={snapshot.detail.run}
                  events={events}
                  select={cite}
                />
              </section>
              <section id="demo-investigation" className="case-panel">
                <h2>Investigation with supporting evidence</h2>
                <h3>Deterministic findings</h3>
                {evidence.facts
                  .filter((f) => f.kind !== "observation")
                  .slice(0, 8)
                  .map((f) => (
                    <article key={f.id}>
                      <p>
                        <strong>{f.kind.replaceAll("_", " ")}</strong> ·{" "}
                        {f.text}
                      </p>
                      {citations(f.event_ids)}
                    </article>
                  ))}
                {snapshot.report ? (
                  <>
                    <h3>Archived Qwen3 investigation</h3>
                    {snapshot.report.report.summary.map((i, n) => (
                      <article key={n}>
                        <p>
                          {
                            snapshot.report!.evidence_snapshot.facts.find(
                              (f) => f.id === i.fact_id,
                            )?.text
                          }
                        </p>
                        {citations(i.event_ids)}
                      </article>
                    ))}
                    <p>
                      The archived report cites verified observations. The application sets the severity.
                    </p>
                  </>
                ) : (
                  <p>
                    No archived model report is available for this scenario.
                  </p>
                )}
              </section>
              <section id="demo-controls" className="case-panel">
                <h2>Policy Firewall and hypothetical replay</h2>
                <p className="simulation-note"><FlaskConical size={15} />Hypothetical simulation. No executable authorization.</p>
                {snapshot.comparison ? (
                  <ReplayTable result={snapshot.comparison} />
                ) : (
                  <p>
                    No comparison was saved for this recording.
                  </p>
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <a href="/shopping">Open shopping agent <ArrowUpRight size={14}/></a>
          </footer>
        </main>
      </div>
    </div>
  );
}
