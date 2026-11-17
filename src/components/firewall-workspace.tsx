"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  Save,
  Shield,
  FlaskConical,
  TriangleAlert,
} from "lucide-react";
import type {
  MerchantRegistry,
  OwnerPolicy,
  ScenarioId,
  GatewayResult,
} from "../lib/firewall-contracts";
import type { LocalIdentity } from "../lib/shopping-contracts";
import { decimalToMinor } from "../lib/shopping-contracts";
import { money } from "../lib/evidence";
import WorkspaceSidebar from "./workspace-sidebar";

const scenarioDescriptions: {
  id: ScenarioId;
  label: string;
  description: string;
  expected: string;
}[] = [
  {
    id: "allowed",
    label: "A · $149 within $150",
    description: "Approved demo merchant, correct currency and quantity.",
    expected: "ALLOW",
  },
  {
    id: "over_budget",
    label: "B · $151 exceeds $150",
    description: "The proposal exceeds the transaction limit.",
    expected: "DENY",
  },
  {
    id: "quantity_mismatch",
    label: "C · Requested 10, proposed 1",
    description: "A business mandate and a proposal with different quantities.",
    expected: "REVIEW",
  },
  {
    id: "unknown_merchant",
    label: "D · Unmapped merchant",
    description: "No server-owned trusted mapping exists.",
    expected: "DENY",
  },
  {
    id: "approval_required",
    label: "E · Beyond automatic authority",
    description: "Budget fits, but independent human review is required.",
    expected: "REVIEW",
  },
];
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Local policy service unavailable");
  return value as T;
}

export default function FirewallWorkspace() {
  const [policies, setPolicies] = useState<OwnerPolicy[]>([]);
  const [registry, setRegistry] = useState<MerchantRegistry | null>(null);
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const [limit, setLimit] = useState("150.00"),
    [automatic, setAutomatic] = useState("150.00");
  const [min, setMin] = useState("1"),
    [max, setMax] = useState("1");
  const [mismatch, setMismatch] = useState<"DENY" | "REVIEW">("DENY");
  const [human, setHuman] = useState(false),
    [code, setCode] = useState("USD");
  const [approved, setApproved] = useState<string[]>([]),
    [prohibited, setProhibited] = useState<string[]>([]);
  const operationLock = useRef(false);
  const [operation, setOperation] = useState<"save" | ScenarioId | null>(null);
  const [completedScenario, setCompletedScenario] = useState<ScenarioId | null>(
    null,
  );
  const pending = operation !== null;
  const [errorLocation, setErrorLocation] = useState<
    "load" | "save" | ScenarioId
  >("load");
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [scenario, setScenario] = useState<
    (GatewayResult & { run: { run_id: string } }) | null
  >(null);
  const selectedPolicy = policies.find((p) => p.version === selected);
  function loadVersion(policy: OwnerPolicy) {
    setNotice("");
    setSelected(policy.version);
    setLabel(policy.label);
    setLimit((policy.max_transaction_minor / 100).toFixed(2));
    setAutomatic((policy.automatic_approval_minor / 100).toFixed(2));
    setMin(String(policy.min_quantity));
    setMax(String(policy.max_quantity));
    setMismatch(policy.quantity_mismatch);
    setHuman(policy.require_human_approval);
    setCode(policy.currency);
    setApproved(policy.approved_merchant_ids);
    setProhibited(policy.prohibited_merchant_ids);
  }
  useEffect(() => {
    let active = true;
    request<{
      policies: OwnerPolicy[];
      registry: MerchantRegistry;
      identity: LocalIdentity;
    }>("/api/policies")
      .then((data) => {
        if (!active) return;
        setPolicies(data.policies);
        setRegistry(data.registry);
        setIdentity(data.identity);
        if (data.policies[0]) loadVersion(data.policies[0]);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedPolicy || operationLock.current) return;
    operationLock.current = true;
    setOperation("save");
    setErrorLocation("save");
    setError(null);
    setNotice("");
    try {
      const response = await request<{ policy: OwnerPolicy }>("/api/policies", {
        parent_version: selected,
        label,
        persona: selectedPolicy.persona,
        currency: code,
        max_transaction_minor: decimalToMinor(limit),
        min_quantity: Number(min),
        max_quantity: Number(max),
        quantity_mismatch: mismatch,
        automatic_approval_minor: decimalToMinor(automatic),
        require_human_approval: human,
        approved_merchant_ids: approved,
        prohibited_merchant_ids: prohibited,
      });
      setPolicies((current) => [response.policy, ...current]);
      loadVersion(response.policy);
      setNotice(
        `Saved revision ${response.policy.revision}. Existing runs retain their original version.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Policy could not be saved");
    } finally {
      operationLock.current = false;
      setOperation(null);
    }
  }
  async function demonstrate(id: ScenarioId) {
    if (operationLock.current) return;
    operationLock.current = true;
    setOperation(id);
    setErrorLocation(id);
    setError(null);
    setScenario(null);
    setCompletedScenario(null);
    try {
      setScenario(
        await request<GatewayResult & { run: { run_id: string } }>(
          "/api/firewall/scenarios",
          { scenario: id },
        ),
      );
      setCompletedScenario(id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Fixture could not be evaluated",
      );
    } finally {
      operationLock.current = false;
      setOperation(null);
    }
  }
  function toggle(
    value: string,
    values: string[],
    setter: (ids: string[]) => void,
  ) {
    setter(
      values.includes(value)
        ? values.filter((id) => id !== value)
        : [...values, value],
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#firewall-main">
        Skip to policy controls
      </a>
      <WorkspaceSidebar active="firewall" />
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            <strong>Policy Firewall</strong>
          </span>
        </header>
        <main className="operations-main" id="firewall-main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>
                Policy Firewall<span className="heading-dot">.</span>
              </h1>
              <p>
                Set spending limits, seller permissions and review requirements.
              </p>
            </div>
            <a className="button secondary" href="/shopping">
              Shopping agent
              <ArrowRight size={15} />
            </a>
          </div>
          {error && errorLocation === "load" && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
            </div>
          )}
          <div className="operations-layout">
            <form className="shopping-form" onSubmit={(e) => void save(e)}>
              <div className="shopping-form-title">
                <Shield size={19} />
                <h2>Owner policy configuration</h2>
                {selectedPolicy && (
                  <span className="op-revision">
                    Revision {selectedPolicy.revision}
                  </span>
                )}
              </div>
              <fieldset
                disabled={pending || !selectedPolicy}
                className="shopping-fields"
                aria-label="Owner policy settings"
              >
                <div className="shopping-field full-width">
                  <label htmlFor="policy-version">Version to revise</label>
                  <select
                    id="policy-version"
                    value={selected}
                    onChange={(e) => {
                      const p = policies.find(
                        (item) => item.version === e.target.value,
                      );
                      if (p) loadVersion(p);
                    }}
                  >
                    {!selectedPolicy && (
                      <option value="">
                        {error && errorLocation === "load"
                          ? "Policies unavailable"
                          : "Loading policy versions…"}
                      </option>
                    )}
                    {policies.map((p) => (
                      <option key={p.version} value={p.version}>
                        {p.persona} · {p.label} · revision {p.revision} ·{" "}
                        {p.version.slice(-8)}
                      </option>
                    ))}
                  </select>
                  <small>
                    Saving creates a new version for future mandates.
                  </small>
                </div>
                <div className="shopping-field full-width">
                  <label htmlFor="policy-label">Policy label</label>
                  <input
                    id="policy-label"
                    required
                    minLength={3}
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
                <h3 className="op-field-heading">Purchase limits</h3>
                <div className="shopping-field">
                  <label htmlFor="policy-limit">
                    Maximum transaction amount
                  </label>
                  <input
                    id="policy-limit"
                    required
                    inputMode="decimal"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                  <small>
                    Both this limit and the original mandate budget must pass.
                  </small>
                </div>
                <div className="shopping-field">
                  <label htmlFor="policy-currency">Required currency</label>
                  <select
                    id="policy-currency"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  >
                    {["USD", "EUR", "GBP", "CAD", "MXN"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="shopping-field">
                  <label htmlFor="policy-min">Minimum permitted quantity</label>
                  <input
                    id="policy-min"
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={min}
                    onChange={(e) => setMin(e.target.value)}
                  />
                </div>
                <div className="shopping-field">
                  <label htmlFor="policy-max">Maximum permitted quantity</label>
                  <input
                    id="policy-max"
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={max}
                    onChange={(e) => setMax(e.target.value)}
                  />
                </div>
                <div className="shopping-field">
                  <label htmlFor="quantity-mismatch">
                    Requested/proposed quantity mismatch
                  </label>
                  <select
                    id="quantity-mismatch"
                    value={mismatch}
                    onChange={(e) =>
                      setMismatch(e.target.value as "DENY" | "REVIEW")
                    }
                  >
                    <option value="DENY">DENY · block mismatches</option>
                    <option value="REVIEW">
                      REVIEW · require independent approval
                    </option>
                  </select>
                </div>
                <div className="shopping-field">
                  <label htmlFor="automatic-authority">
                    Automatic-approval amount
                  </label>
                  <input
                    id="automatic-authority"
                    inputMode="decimal"
                    required
                    value={automatic}
                    onChange={(e) => setAutomatic(e.target.value)}
                  />
                  <small>
                    Above this authority requires REVIEW, even when budget fits.
                  </small>
                </div>
                <label className="checkbox-label full-width">
                  <input
                    type="checkbox"
                    checked={human}
                    onChange={(e) => setHuman(e.target.checked)}
                  />
                  Always require human review
                </label>
                <h3 className="op-field-heading">Seller permissions</h3>
                <fieldset className="merchant-choices">
                  <legend>Approved registered merchants</legend>
                  {registry?.mappings.map((m) => (
                    <label className="checkbox-label" key={m.merchant_id}>
                      <input
                        type="checkbox"
                        checked={approved.includes(m.merchant_id)}
                        onChange={() =>
                          toggle(m.merchant_id, approved, setApproved)
                        }
                      />
                      <span>
                        {m.label}
                        <small>{m.merchant_id} · demo mapping only</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="merchant-choices">
                  <legend>Prohibited registered merchants</legend>
                  {registry?.mappings.map((m) => (
                    <label className="checkbox-label" key={m.merchant_id}>
                      <input
                        type="checkbox"
                        checked={prohibited.includes(m.merchant_id)}
                        onChange={() =>
                          toggle(m.merchant_id, prohibited, setProhibited)
                        }
                      />
                      <span>
                        {m.label}
                        <small>{m.merchant_id}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </fieldset>
              <div className="op-policy-note">
                <Shield size={16} aria-hidden="true" />
                <p>
                  Prohibited sellers take precedence. Unknown sellers and
                  unverified Channel3 merchants are denied.
                </p>
              </div>
              {error && errorLocation === "save" && (
                <div className="error-banner op-form-feedback" role="alert">
                  <TriangleAlert size={17} />
                  <span>{error}</span>
                </div>
              )}
              <div className="shopping-submit">
                <p role="status">
                  {notice ||
                    (selectedPolicy
                      ? `Local owner: ${identity?.owner_id ?? "unavailable"}.`
                      : error
                        ? "Policy configuration unavailable."
                        : "Loading policy versions…")}
                </p>
                <button
                  className="button primary"
                  disabled={pending || !selectedPolicy}
                  type="submit"
                >
                  <Save size={16} />
                  {operation === "save"
                    ? "Saving version…"
                    : "Save new policy version"}
                </button>
              </div>
            </form>
            <section
              className="policy-demonstrations"
              aria-label="Controlled policy scenarios"
            >
              <div className="shopping-form-title">
                <FlaskConical size={19} />
                <h2>Controlled policy scenarios</h2>
              </div>
              <p>
                Test the Firewall with synthetic proposals and fixed policies.
                Each evaluation records a decision in Black Box.
              </p>
              <div className="scenario-grid">
                {scenarioDescriptions.map((s) => (
                  <article
                    key={s.id}
                    className={
                      completedScenario === s.id
                        ? "op-scenario-active"
                        : undefined
                    }
                  >
                    <span
                      className={`op-expected op-${s.expected.toLowerCase()}`}
                    >
                      Expected {s.expected}
                    </span>
                    <h3>{s.label}</h3>
                    <p>{s.description}</p>
                    <button
                      className="button secondary"
                      disabled={pending}
                      onClick={() => void demonstrate(s.id)}
                    >
                      {operation === s.id
                        ? "Evaluating…"
                        : `Evaluate ${s.label.slice(0, 1)}`}
                      <ArrowRight size={14} />
                    </button>
                    {error && errorLocation === s.id && (
                      <div className="error-banner" role="alert">
                        <TriangleAlert size={15} />
                        <span>{error}</span>
                      </div>
                    )}
                    {completedScenario === s.id && scenario && (
                      <div className="fixture-result" role="status">
                        <span
                          className={`outcome-badge ${scenario.decision.outcome.toLowerCase()}`}
                        >
                          {scenario.decision.outcome}
                        </span>
                        <p>{scenario.decision.reason_codes.join(" · ")}</p>
                        <p>
                          {money(
                            scenario.proposal.action.total_amount_minor,
                            scenario.proposal.action.currency,
                          )}{" "}
                          · quantity {scenario.proposal.action.quantity} ·
                          payment executed: false
                        </p>
                        <a
                          className="button secondary"
                          href={`/?run=${encodeURIComponent(scenario.run.run_id)}`}
                        >
                          Inspect fixture in Black Box
                          <ArrowRight size={15} />
                        </a>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
