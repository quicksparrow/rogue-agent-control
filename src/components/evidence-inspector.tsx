"use client";

import { Braces, CornerUpLeft, Link2, ShieldCheck } from "lucide-react";
import type { Run, StoredEvent } from "../lib/contracts";
import { discrepancies, eventLabels, summary } from "../lib/evidence";
import { publicFixtureText } from "../lib/fixture-content";

export default function EvidenceInspector({
  event,
  run,
  events,
  select,
}: {
  event?: StoredEvent;
  run: Run;
  events: StoredEvent[];
  select: (id: string) => void;
}) {
  const parent = events.find((e) => e.event_id === event?.parent_event_id);
  const flags = event ? discrepancies(run, event) : [];
  return (
    <aside className="inspector" aria-label="Evidence inspector">
      <div className="panel-title">
        <span>
          <Braces size={17} />
          Evidence inspector
        </span>
        <span className="muted mono">
          {event ? `#${String(event.sequence).padStart(2, "0")}` : ""}
        </span>
      </div>
      {!event ? (
        <div className="inspector-empty">
          <Braces size={30} />
          <h3>Select an event</h3>
          <p>
            The persisted evidence, timing, and parent link will appear here.
          </p>
        </div>
      ) : (
        <div className="inspector-body" data-testid="evidence-inspector">
          <span
            className={`badge ${run.mode === "synthetic" ? "synthetic" : "neutral"}`}
          >
            {run.mode === "synthetic"
              ? "SYNTHETIC EVIDENCE"
              : run.mode === "integration"
                ? "SERVER-INSTRUMENTED EVIDENCE"
                : "EXTERNAL · UNVERIFIED"}
          </span>
          <h3>{eventLabels[event.event_type]}</h3>
          <p className="event-description">{summary(event)}</p>
          {flags.length > 0 && (
            <div className="discrepancy">
              <strong>Mandate discrepancies</strong>
              {flags.map((flag) => (
                <span key={flag}>{flag}</span>
              ))}
              <small>
                {run.policy.firewall
                  ? "Original proposal preserved. Inspect the separately recorded deterministic policy decision."
                  : "Comparison only. No policy was enforced."}
              </small>
            </div>
          )}
          <dl className="evidence-meta">
            <div>
              <dt>Event ID</dt>
              <dd className="mono break">{event.event_id}</dd>
            </div>
            <div>
              <dt>Producer time</dt>
              <dd className="mono">{event.timestamp}</dd>
            </div>
            <div>
              <dt>Collector time</dt>
              <dd className="mono">{event.recorded_at}</dd>
            </div>
            <div>
              <dt>Reported actor</dt>
              <dd>{event.actor.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Provenance</dt>
              <dd>
                {event.provenance.source} ·{" "}
                {event.provenance.trusted
                  ? "application-owned record"
                  : "content untrusted"}
              </dd>
            </div>
            <div>
              <dt>Policy / schema</dt>
              <dd className="mono">
                {event.policy_version} / {event.schema_version}
              </dd>
            </div>
            <div>
              <dt>Tool</dt>
              <dd className="mono">{event.tool ?? "None reported"}</dd>
            </div>
          </dl>
          {run.recording_kind === "firewall_fixture" && (
            <p className="form-note">
              Synthetic input; real deterministic evaluation. No model or
              payment operation ran.
            </p>
          )}
          {event.schema_version === 4 && (
            <p className="form-note">
              Sandbox payment record. No real money. Observed order creation, buyer
              approval and capture are separate stages. No retailer fulfillment
              is implied.
            </p>
          )}
          {event.event_type === "external_content_observed" && (
            <div className="fixture-text">
              <span className="eyebrow">REVIEWED FIXTURE REFERENCE</span>
              <p>{publicFixtureText[String(event.payload.fixture_code)]}</p>
              <small>
                This reference text is not evidence of a model reading or
                following it. A causal claim requires later investigation.
              </small>
            </div>
          )}
          <div className="parent-box">
            <Link2 size={15} />
            <span>Parent event</span>
            {parent ? (
              <button onClick={() => select(parent.event_id)}>
                <CornerUpLeft size={13} />#
                {String(parent.sequence).padStart(2, "0")}{" "}
                {eventLabels[parent.event_type]}
              </button>
            ) : (
              <span className="mono break">
                {event.parent_event_id
                  ? `Missing: ${event.parent_event_id}`
                  : "Root event"}
              </span>
            )}
          </div>
          <details className="correlation">
            <summary>Run & trace correlation</summary>
            <dl>
              <dt>Run ID</dt>
              <dd className="mono break">{event.run_id}</dd>
              <dt>Trace ID</dt>
              <dd className="mono break">{event.trace_id}</dd>
            </dl>
          </details>
          <div className="json-label">
            <span className="eyebrow">PERSISTED RECORD</span>
            <span className="mono">JSON</span>
          </div>
          <pre tabIndex={0} aria-label="Persisted event JSON">
            {JSON.stringify(event, null, 2)}
          </pre>
          <p className="redaction-note">
            <ShieldCheck size={14} />
            Allowlisted payload · {event.redacted_field_count} fields omitted
            before storage. This is the sanitized persisted record.
          </p>
        </div>
      )}
    </aside>
  );
}
