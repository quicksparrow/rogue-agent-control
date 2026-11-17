"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Box,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  FlaskConical,
  Layers3,
  List,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Table2,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import type {
  Persona,
  Run,
  RunDetail,
  Scenario,
  StoredEvent,
} from "../lib/contracts";
import { discrepancies, eventLabels, money, summary } from "../lib/evidence";
import EvidenceInspector from "./evidence-inspector";
import RecordingDialog from "./recording-dialog";
import WorkspaceSidebar from "./workspace-sidebar";
import ShoppingResults from "./shopping-results";

const EventGrid = dynamic(() => import("./event-grid"), {
  ssr: false,
  loading: () => <p className="loading">Loading event explorer…</p>,
});

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Request failed. Check the local server.");
  return data as T;
}

export default function BlackBox() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [runId, setRunId] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("all");
  const [view, setView] = useState<"timeline" | "grid">("timeline");
  const [dialog, setDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const recording = useRef(false);
  const [reveal, setReveal] = useState<{eventId: string}>();
  const detailToken = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(tag) &&
        !(event.target as HTMLElement)?.isContentEditable &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    let active = true;
    setError(null);
    setLoading(true);
    request<{ runs: Run[] }>("/api/runs")
      .then((result) => {
        if (!active) return;
        setRuns(result.runs);
        const requested = new URLSearchParams(window.location.search).get(
          "run",
        );
        setRunId(
          (current) =>
            current ||
            result.runs.find((r) => r.run_id === requested)?.run_id ||
            result.runs[0]?.run_id ||
            "",
        );
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!runId) return;
    const token = ++detailToken.current;
    setLoading(true);
    setError(null);
    request<RunDetail>(`/api/runs/${runId}`)
      .then((result) => {
        if (token !== detailToken.current) return;
        setDetail(result);
        setSelectedId((current) =>
          result.events.some((e) => e.event_id === current)
            ? current
            : (result.events.find(
                (e) =>
                  e.event_id ===
                  new URLSearchParams(window.location.search).get("event"),
              )?.event_id ??
              result.events.find((e) => discrepancies(result.run, e).length)
                ?.event_id ??
              result.events[0]?.event_id),
        );
      })
      .catch((e) => token === detailToken.current && setError(e.message))
      .finally(() => token === detailToken.current && setLoading(false));
    return () => {
      detailToken.current++;
    };
  }, [runId, refresh]);

  const record = useCallback(async (persona: Persona, scenario: Scenario) => {
    if (recording.current) return;
    recording.current = true;
    setPending(true);
    setError(null);
    setNotice("");
    try {
      const result = await request<{ run: Run }>("/api/demos", {
        persona,
        scenario,
      });
      setRuns((current) => [result.run, ...current]);
      setRunId(result.run.run_id);
      setQuery("");
      setActor("all");
      setDetail(null);
      setDialog(false);
      setNotice("Synthetic recording saved to SQLite.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record scenario");
    } finally {
      recording.current = false;
      setPending(false);
    }
  }, []);

  const activeDetail = detail?.run.run_id === runId ? detail : null;
  const run = activeDetail?.run;
  const events = activeDetail?.events ?? [];
  const selected = events.find((e) => e.event_id === selectedId);
  const filtered = events.filter(
    (e) =>
      (actor === "all" || actor === e.actor) &&
      `${summary(e)} ${eventLabels[e.event_type]} ${e.event_type} ${e.actor} ${e.event_id} ${e.tool ?? ""} ${JSON.stringify(e.payload)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const proposal = events.findLast(
    (e) =>
      e.event_type === "purchase_proposed" ||
      e.event_type === "recommendation_recorded",
  );
  const flags = run && proposal ? discrepancies(run, proposal) : [];
  const select = (id: string) => {
    setSelectedId(id);
  };
  const selectParent = (id: string) => {
    setReveal({eventId: id});
    setQuery("");
    setActor("all");
    select(id);
  };
  const changeRun = (id: string) => {
    if (id === runId) return;
    setRunId(id);
    setDetail(null);
    setSelectedId(undefined);
    setQuery("");
    setActor("all");
    setNotice("");
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to Black Box
      </a>
      <WorkspaceSidebar active="black-box" />

      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>Black Box</strong>
          </span>
          <span className="phase-tag">
            <span />
            Local workspace
          </span>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>Black Box</h1>
              <p>
                Inspect a shopping run from its original mandate to the final event.
              </p>
            </div>
            <a className="button secondary" href="/demo">
              Explore Demo
            </a>
            {runId && (
              <a
                className="button secondary"
                href={`/investigate?run=${encodeURIComponent(runId)}`}
              >
                Investigate
              </a>
            )}
            <button
              className="button primary"
              onClick={() => {
                setError(null);
                setDialog(true);
              }}
              disabled={pending}
            >
              <Plus size={17} />
              New recording
            </button>
          </div>

          <div className="phase-notice">
            <FlaskConical size={17} />
            <span>
              <strong>Evidence sources</strong>. Each event identifies its source: local model, synthetic fixture, external producer or sandbox payment provider.
            </span>
          </div>
          <div className="sr-only" role="status" aria-live="polite">
            {notice}
            {loading ? " Loading recordings." : ""}
          </div>
          {error && !dialog && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
              <button onClick={() => setRefresh((n) => n + 1)}>Retry</button>
            </div>
          )}

          {runs.length > 0 && (
            <div className="recording-bar">
              <div className="recording-select">
                <CircleDot size={18} />
                <label htmlFor="recording-select">Recording</label>
                <select
                  id="recording-select"
                  value={runId}
                  onChange={(e) => changeRun(e.target.value)}
                >
                  {runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {r.title} · {new Date(r.created_at).toLocaleTimeString()}{" "}
                      · {r.run_id.slice(-6)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="button subtle compact"
                onClick={() => setRefresh((n) => n + 1)}
                disabled={loading}
                aria-label="Refresh recordings"
              >
                <RefreshCw size={15} />
                <span>Refresh</span>
              </button>
            </div>
          )}

          {loading && !activeDetail ? (
            <div className="loading" role="status">
              <Activity size={24} />
              <p>Opening the evidence store…</p>
            </div>
          ) : !run ? (
            <section className="empty-state">
              <div className="empty-mark">
                <Layers3 size={40} strokeWidth={1.2} />
              </div>
              <h2>No recordings yet</h2>
              <p>
                Record a controlled shopping scenario to inspect the original
                mandate,
                <br className="desktop-only" /> the untrusted listing, and the
                proposed purchase.
              </p>
              <div className="empty-actions">
                <button
                  className="button primary"
                  disabled={pending}
                  onClick={() => void record("consumer", "deviation")}
                >
                  <ShoppingBag size={17} />
                  Record consumer fixture
                  <ArrowRight size={16} />
                </button>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() => void record("business", "deviation")}
                >
                  Record B2B fixture
                </button>
              </div>
              <span className="empty-foot">
                <Database size={14} />
                Fixtures are saved locally and labeled synthetic.
              </span>
            </section>
          ) : (
            <>
              <div className="run-heading">
                <div>
                  <span
                    className={`badge ${run.mode === "synthetic" ? "synthetic" : "neutral"}`}
                  >
                    <FlaskConical size={11} />
                    {run.mode === "synthetic"
                      ? "SYNTHETIC RECORDING"
                      : run.mode === "integration"
                        ? "SHOPPING RUNTIME RECORDING"
                        : "EXTERNAL · UNVERIFIED"}
                  </span>
                  <span className="persona-tag">
                    {run.persona === "consumer"
                      ? "CONSUMER SHOPPING"
                      : "B2B PURCHASING"}
                  </span>
                  <h2>
                    {run.title.split(" / ")[0]}
                    <span>
                      {run.scenario === "deviation"
                        ? "Mandate deviation"
                        : run.scenario === "authorized"
                          ? "Within mandate fixture"
                          : run.mode === "integration"
                            ? "Shopping research"
                            : "External recording"}
                    </span>
                  </h2>
                </div>
                <div className="run-id">
                  <span className="eyebrow">Run ID</span>
                  <span className="mono break">{run.run_id}</span>
                </div>
              </div>

              <section className="summary-strip" aria-label="Recording summary">
                <div>
                  <span className="summary-label">Mandate limit</span>
                  <strong>
                    {money(run.policy.max_total_minor, run.policy.currency)}
                    <small>maximum total</small>
                  </strong>
                  <span>
                    {run.policy.merchant_ids.join(", ")} · policy{" "}
                    {run.policy.version}
                  </span>
                </div>
                <div
                  className={
                    flags.length
                      ? "summary-proposal flagged"
                      : "summary-proposal"
                  }
                >
                  <span className="summary-label">Recorded proposal</span>
                  <strong>
                    {proposal
                      ? money(
                          proposal.payload.total_amount_minor,
                          proposal.payload.currency,
                        )
                      : "Not observed"}
                    {flags.length > 0 && <TriangleAlert size={18} />}
                  </strong>
                  <span>
                    {flags.length
                      ? flags.join(" · ")
                      : proposal
                        ? "Within numeric / merchant reference checks"
                        : "No purchase proposal event"}
                  </span>
                </div>
                <div>
                  <span className="summary-label">Stored evidence</span>
                  <strong>
                    {events.length}
                    <small>events</small>
                  </strong>
                  <span>
                    {activeDetail?.gaps.length ?? 0} visibility notes · receipt
                    order preserved
                  </span>
                </div>
              </section>

              {activeDetail?.shopping && (
                <ShoppingResults
                  execution={activeDetail.shopping}
                  includeBlackBoxLink={false}
                />
              )}

              <div className="investigation-grid">
                <section
                  className="execution-panel"
                  aria-label="Execution events"
                >
                  <div className="panel-title">
                    <span>
                      <Activity size={17} />
                      Execution timeline
                    </span>
                    <span className="count-label">
                      {filtered.length} OF {events.length} EVENTS
                    </span>
                  </div>
                  <div className="event-controls">
                    <div
                      className="view-switch"
                      role="group"
                      aria-label="Event view"
                    >
                      <button
                        aria-pressed={view === "timeline"}
                        onClick={() => setView("timeline")}
                      >
                        <List size={15} />
                        Timeline
                      </button>
                      <button
                        aria-pressed={view === "grid"}
                        onClick={() => setView("grid")}
                      >
                        <Table2 size={15} />
                        Explorer
                      </button>
                    </div>
                    <label className="actor-filter">
                      <span className="sr-only">Filter by actor</span>
                      <select
                        aria-label="Filter by actor"
                        value={actor}
                        onChange={(e) => setActor(e.target.value)}
                      >
                        <option value="all">All actors</option>
                        {Array.from(new Set(events.map((e) => e.actor))).map(
                          (a) => (
                            <option key={a} value={a}>
                              {a.replaceAll("_", " ")}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <div className="search-box">
                    <Search size={16} />
                    <input
                      ref={searchInput}
                      aria-label="Search events"
                      placeholder="Search events, tools, evidence, or IDs…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>/</kbd>
                  </div>
                  {view === "timeline" ? (
                    <div className="timeline">
                      <div className="timeline-caption">
                        <ArrowDown size={12} />
                        COLLECTOR RECEIPT ORDER<span>PRODUCER TIME · UTC</span>
                      </div>
                      {!filtered.length ? (
                        <div className="no-results">
                          <Search size={25} />
                          <h3>
                            {events.length
                              ? "No matching events"
                              : "Waiting for evidence"}
                          </h3>
                          <p>
                            {events.length
                              ? "Change the search or actor filter to see more evidence."
                              : "Send an event batch to this run using the documented local API."}
                          </p>
                          {events.length > 0 && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setQuery("");
                                setActor("all");
                              }}
                            >
                              Clear filters
                            </button>
                          )}
                        </div>
                      ) : (
                        <ol className="event-list">
                          {filtered.map((event) => (
                            <TimelineEvent
                              key={event.event_id}
                              event={event}
                              run={run}
                              selected={event.event_id === selectedId}
                              onSelect={() => select(event.event_id)}
                            />
                          ))}
                        </ol>
                      )}
                    </div>
                  ) : (
                    <EventGrid
                      events={filtered}
                      selectedId={selectedId}
                      reveal={reveal}
                      onSelect={select}
                    />
                  )}
                  <div className="timeline-footer">
                    <Database size={13} />
                    <span>
                      Persisted in SQLite · schema{" "}
                      {events.some((e) => e.schema_version === 4)
                        ? "v2 + v3 + v4"
                        : run.policy.firewall
                          ? "v2 + v3"
                          : run.mode === "integration"
                            ? "v2"
                            : "v1"}
                    </span>
                    <span>Manual refresh</span>
                  </div>
                </section>
                <EvidenceInspector
                  event={selected}
                  run={run}
                  events={events}
                  select={selectParent}
                />
              </div>

              <details className="visibility-panel" open>
                <summary>
                  <span>
                    <TriangleAlert size={16} />
                    Visibility & limitations{" "}
                    <span className="note-count">
                      {activeDetail?.gaps.length}
                    </span>
                  </span>
                  <span className="details-hint">
                    Recording diagnostics
                  </span>
                </summary>
                <ul>
                  {activeDetail?.gaps.map((gap, i) => (
                    <li key={`${gap.code}-${i}`}>
                      <span className="note-dot" />
                      <span>{gap.message}</span>
                      {gap.event_id && (
                        <button
                          className="text-button"
                          onClick={() => selectParent(gap.event_id!)}
                        >
                          Inspect event
                          <ChevronRight size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
              <details className="capture-guide">
                <summary>
                  <Terminal size={16} />
                  Capture your own events
                  <span>Local API · sender identity unverified</span>
                </summary>
                <p>
                  Create a separate external run with{" "}
                  <code>POST /api/runs</code>, then append schema v1 events to{" "}
                  <code>/api/runs/:runId/events</code>. Synthetic recordings are
                  immutable to external ingestion.
                </p>
                <p>
                  The README includes a PowerShell example. Only structured,
                  allowlisted payload fields are stored. Actor, tool, and status
                  claims from external senders are always marked unverified.
                </p>
                <pre>{`POST /api/runs\nContent-Type: application/json\n\n{ "persona": "consumer" }`}</pre>
              </details>
            </>
          )}

        </main>
      </div>
      {dialog && (
        <RecordingDialog
          close={() => setDialog(false)}
          record={record}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}

function TimelineEvent({
  event,
  run,
  selected,
  onSelect,
}: {
  event: StoredEvent;
  run: Run;
  selected: boolean;
  onSelect: () => void;
}) {
  const flagged = discrepancies(run, event).length > 0;
  const actorIcon =
    event.actor === "human" ? (
      <Check size={14} />
    ) : event.actor === "catalog" ? (
      <ShoppingBag size={14} />
    ) : event.actor === "shopping_agent" ? (
      <Box size={14} />
    ) : (
      <CircleDot size={14} />
    );
  return (
    <li
      className={`timeline-item ${selected ? "selected" : ""} ${flagged ? "flagged" : ""}`}
    >
      <button
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Inspect event ${event.sequence}: ${eventLabels[event.event_type]}`}
      >
        <span className="event-node">{actorIcon}</span>
        <span className="event-content">
          <span className="event-top">
            <span className="event-sequence mono">
              {String(event.sequence).padStart(2, "0")}
            </span>
            <strong>{eventLabels[event.event_type]}</strong>
            {flagged && <span className="discrepancy-tag">DEVIATION</span>}
          </span>
          <span className="event-summary">{summary(event)}</span>
          <span className="event-bottom">
            <span className="actor-name">
              {event.actor.replaceAll("_", " ")}
            </span>
            <span className="event-origin">
              {run.mode === "synthetic"
                ? "synthetic"
                : run.mode === "integration"
                  ? event.provenance.source
                  : "unverified"}
            </span>
          </span>
        </span>
        <span className="event-time mono">
          {event.timestamp.slice(11, 19)}
          <ChevronRight size={13} />
        </span>
      </button>
    </li>
  );
}
