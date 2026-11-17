"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  FlaskConical,
  RefreshCw,
  ShoppingBag,
  Cable,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { Persona } from "../lib/contracts";
import {
  decimalToMinor,
  type CatalogMode,
  type LocalIdentity,
  type ShoppingExecution,
} from "../lib/shopping-contracts";
import WorkspaceSidebar from "./workspace-sidebar";
import ShoppingResults from "./shopping-results";
import type { OwnerPolicy } from "../lib/firewall-contracts";

interface Integrations {
  ollama: {
    available: boolean;
    model?: string;
    think?: boolean;
    context_length?: number;
    error?: string;
  };
  channel3: { configured: boolean };
  identity: LocalIdentity;
}
async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The local request failed.");
  return data as T;
}

export default function ShoppingWorkspace() {
  const [persona, setPersona] = useState<Persona>("consumer");
  const [mode, setMode] = useState<CatalogMode>("offline");
  const [objective, setObjective] = useState(
    "Find everyday running shoes under $120.",
  );
  const [budget, setBudget] = useState("120.00");
  const [quantity, setQuantity] = useState("1");
  const [currency, setCurrency] = useState("USD");
  const [preferences, setPreferences] = useState("Everyday comfort");
  const [merchants, setMerchants] = useState("seed_sports");
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [healthPending, setHealthPending] = useState(true);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const budgetInput = useRef<HTMLInputElement>(null);
  const quantityInput = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<
    "budget" | "quantity" | null
  >(null);
  const [healthError, setHealthError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ShoppingExecution | null>(null);
  const [healthVersion, setHealthVersion] = useState(0);
  const [policies, setPolicies] = useState<OwnerPolicy[]>([]);
  const [policyUnavailable, setPolicyUnavailable] = useState(false);
  const [policyVersion, setPolicyVersion] = useState("");
  useEffect(() => {
    let active = true;
    call<{ policies: OwnerPolicy[] }>("/api/policies")
      .then((result) => {
        if (active) setPolicies(result.policies);
      })
      .catch((e) => {
        if (active) {
          setPolicyUnavailable(true);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setPolicyVersion((current) =>
      policies.some((p) => p.version === current && p.persona === persona)
        ? current
        : (policies.find((p) => p.persona === persona)?.version ?? ""),
    );
  }, [persona, policies]);
  useEffect(() => {
    let active = true;
    setHealthPending(true);
    setHealthError(false);
    call<Integrations>("/api/integrations")
      .then((data) => {
        if (active) setIntegrations(data);
      })
      .catch(() => {
        if (active) {
          setHealthError(true);
          setIntegrations(null);
        }
      })
      .finally(() => {
        if (active) setHealthPending(false);
      });
    return () => {
      active = false;
    };
  }, [healthVersion]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("run");
    if (!id || !/^run_[a-f0-9-]+$/.test(id)) return;
    let active = true;
    call<{ execution: ShoppingExecution }>(`/api/shopping/${id}`)
      .then((data) => {
        if (active) setExecution(data.execution);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  function changePersona(value: Persona) {
    setPersona(value);
    setObjective(
      value === "consumer"
        ? "Find everyday running shoes under $120."
        : "Find 10 wireless mice for our office with a total budget of $250.",
    );
    setBudget(value === "consumer" ? "120.00" : "250.00");
    setQuantity(value === "consumer" ? "1" : "10");
    setPreferences(
      value === "consumer" ? "Everyday comfort" : "Wireless, quiet operation",
    );
    setMerchants(
      mode === "offline"
        ? value === "consumer"
          ? "seed_sports"
          : "seed_office"
        : "amazon.com",
    );
  }
  async function execute(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setInvalidField(null);
    setError(null);
    let budgetMinor: number;
    try {
      budgetMinor = decimalToMinor(budget);
      if (budgetMinor < 1) throw new Error();
    } catch {
      setInvalidField("budget");
      budgetInput.current?.focus();
      setError("Enter a positive budget with at most two decimal places.");
      return;
    }
    const requestedQuantity = Number(quantity);
    if (
      !Number.isInteger(requestedQuantity) ||
      requestedQuantity < 1 ||
      requestedQuantity > 10000
    ) {
      setInvalidField("quantity");
      quantityInput.current?.focus();
      setError("Quantity must be a whole number from 1 to 10,000.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setExecution(null);
    let created: ShoppingExecution | undefined;
    try {
      const response = await call<{ execution: ShoppingExecution }>(
        "/api/shopping",
        {
          persona,
          catalog_mode: mode,
          objective,
          budget_minor: budgetMinor,
          quantity: requestedQuantity,
          currency,
          preferences: preferences
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          merchant_ids: merchants
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(policyVersion ? { owner_policy_version: policyVersion } : {}),
        },
      );
      created = response.execution;
      setExecution(created);
      window.history.replaceState(
        null,
        "",
        `/shopping?run=${encodeURIComponent(created.run_id)}`,
      );
      const result = await call<{ execution: ShoppingExecution }>(
        `/api/shopping/${created.run_id}/execute`,
        {},
      );
      setExecution(result.execution);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Execution could not complete.",
      );
      if (created) {
        try {
          const saved = await call<{ execution: ShoppingExecution }>(
            `/api/shopping/${created.run_id}`,
          );
          setExecution(saved.execution);
        } catch {
          /* Preserve the already saved run link on transport failure. */
        }
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#shopping-main">
        Skip to shopping
      </a>
      <WorkspaceSidebar active="shopping" />
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            <strong>Shopping agent</strong>
          </span>
        </header>
        <main className="operations-main" id="shopping-main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>
                Shopping agent<span className="heading-dot">.</span>
              </h1>
              <p>Set purchasing limits and ask Qwen3 to research products.</p>
            </div>
            <a className="button secondary" href="/">
              Open Black Box
              <ArrowRight size={15} />
            </a>
          </div>
          <div className="operations-layout">
            <form className="shopping-form" onSubmit={(e) => void execute(e)}>
              <div className="shopping-form-title">
                <ShoppingBag size={19} />
                <h2>Shopping mandate</h2>
              </div>
              <fieldset
                disabled={pending}
                className="shopping-fields"
                aria-label="Shopping mandate settings"
              >
                <div className="shopping-field">
                  <label htmlFor="shopping-persona">Shopping scenario</label>
                  <select
                    id="shopping-persona"
                    value={persona}
                    onChange={(e) => changePersona(e.target.value as Persona)}
                  >
                    <option value="consumer">Consumer shopping</option>
                    <option value="business">Business purchasing</option>
                  </select>
                </div>
                <div className="shopping-field">
                  <label htmlFor="catalog-mode">Catalog mode</label>
                  <select
                    id="catalog-mode"
                    value={mode}
                    onChange={(e) => {
                      const next = e.target.value as CatalogMode;
                      setMode(next);
                      setMerchants(
                        next === "channel3"
                          ? "amazon.com"
                          : persona === "consumer"
                            ? "seed_sports"
                            : "seed_office",
                      );
                    }}
                  >
                    <option value="offline">
                      Offline · deterministic seeded products
                    </option>
                    <option value="channel3">
                      Channel3 Live · actual product search
                    </option>
                  </select>
                </div>
                <div className="shopping-field full-width">
                  <label htmlFor="shopping-policy">Owner policy version</label>
                  <select
                    id="shopping-policy"
                    aria-describedby="shopping-policy-help"
                    value={policyVersion}
                    onChange={(e) => setPolicyVersion(e.target.value)}
                  >
                    {!policyVersion && (
                      <option value="">
                        {policyUnavailable
                          ? "Owner policies unavailable"
                          : "Loading owner policy versions…"}
                      </option>
                    )}
                    {policies
                      .filter((p) => p.persona === persona)
                      .map((p) => (
                        <option key={p.version} value={p.version}>
                          {p.label} · revision {p.revision} ·{" "}
                          {p.version.slice(-8)}
                        </option>
                      ))}
                  </select>
                  <small id="shopping-policy-help">
                    This version is frozen when you create the mandate.{" "}
                    <a href="/firewall">Configure a new policy version</a>.
                  </small>
                </div>
                <div className="shopping-field full-width">
                  <label htmlFor="shopping-objective">Shopping objective</label>
                  <textarea
                    id="shopping-objective"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    required
                    minLength={5}
                    maxLength={360}
                    rows={2}
                  />
                  <small>Omit credentials and personal buyer details.</small>
                </div>
                <div className="constraints-row">
                  <div className="shopping-field">
                    <label htmlFor="shopping-budget">Total budget</label>
                    <input
                      id="shopping-budget"
                      ref={budgetInput}
                      aria-invalid={invalidField === "budget"}
                      aria-describedby={
                        invalidField === "budget" ? "shopping-error" : undefined
                      }
                      inputMode="decimal"
                      value={budget}
                      onChange={(e) => {
                        setBudget(e.target.value);
                        if (invalidField === "budget") {
                          setInvalidField(null);
                          setError(null);
                        }
                      }}
                      required
                      maxLength={12}
                    />
                    {invalidField === "budget" && error && (
                      <small
                        className="op-field-error"
                        id="shopping-error"
                        role="alert"
                      >
                        {error}
                      </small>
                    )}
                  </div>
                  <div className="shopping-field">
                    <label htmlFor="shopping-currency">Currency</label>
                    <select
                      id="shopping-currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {["USD", "EUR", "GBP", "CAD", "MXN"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="shopping-field">
                    <label htmlFor="shopping-quantity">
                      Quantity per alternative
                    </label>
                    <input
                      id="shopping-quantity"
                      ref={quantityInput}
                      aria-invalid={invalidField === "quantity"}
                      aria-describedby={
                        invalidField === "quantity"
                          ? "shopping-error"
                          : undefined
                      }
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={quantity}
                      onChange={(e) => {
                        setQuantity(e.target.value);
                        if (invalidField === "quantity") {
                          setInvalidField(null);
                          setError(null);
                        }
                      }}
                      required
                    />
                    {invalidField === "quantity" && error && (
                      <small
                        className="op-field-error"
                        id="shopping-error"
                        role="alert"
                      >
                        {error}
                      </small>
                    )}
                  </div>
                </div>
                <div className="shopping-field">
                  <label htmlFor="shopping-preferences">
                    Preferences, separated by commas
                  </label>
                  <input
                    id="shopping-preferences"
                    value={preferences}
                    onChange={(e) => setPreferences(e.target.value)}
                    maxLength={300}
                  />
                  <small>Enter up to four short preferences.</small>
                </div>
                <div className="shopping-field">
                  <label htmlFor="shopping-merchants">
                    Reference merchant IDs
                  </label>
                  <input
                    id="shopping-merchants"
                    value={merchants}
                    onChange={(e) => setMerchants(e.target.value)}
                    required
                    maxLength={400}
                  />
                  <small>
                    Separate IDs with commas. The Firewall verifies seller
                    identity.
                  </small>
                </div>
              </fieldset>
              {error && !invalidField && (
                <div
                  id="shopping-error"
                  className="error-banner op-form-feedback"
                  role="alert"
                >
                  <TriangleAlert size={17} />
                  <span>{error}</span>
                </div>
              )}
              <div className="shopping-submit">
                <p>
                  <FlaskConical size={15} />
                  {mode === "offline"
                    ? "Qwen3 with seeded products."
                    : "Qwen3 with live Channel3 search."}
                </p>
                <button
                  className="button primary"
                  disabled={pending || !policyVersion}
                  type="submit"
                >
                  {pending ? (
                    <>
                      <Activity size={16} />
                      Executing local agent…
                    </>
                  ) : (
                    <>
                      Run shopping agent
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </form>
            <aside className="operation-rail" aria-label="Shopping context">
              <section
                className="op-rail-section"
                aria-label="Integration status"
              >
                <h2>
                  <Cable size={18} aria-hidden="true" /> Integrations
                </h2>
                <div className="op-service">
                  <div className="op-service-name">
                    Ollama <span>Qwen3 4B</span>
                  </div>
                  <strong
                    className="op-service-state"
                    data-state={
                      healthPending || healthError
                        ? "unknown"
                        : integrations?.ollama.available
                          ? "ready"
                          : "unavailable"
                    }
                  >
                    {healthPending
                      ? "Checking local model…"
                      : healthError
                        ? "Status unavailable"
                        : integrations?.ollama.available
                          ? "Model available"
                          : "Model unavailable"}
                  </strong>
                  <p>
                    {integrations?.ollama.available
                      ? `${integrations.ollama.context_length} context tokens. Thinking ${integrations.ollama.think ? "enabled, never stored" : "disabled"}.`
                      : healthError
                        ? "Check the connection and try again."
                        : integrations?.ollama.error}
                  </p>
                </div>
                <div className="op-service">
                  <div className="op-service-name">
                    Channel3 <span>Live catalog</span>
                  </div>
                  <strong
                    className="op-service-state"
                    data-state={
                      integrations?.channel3.configured ? "ready" : "unknown"
                    }
                  >
                    {integrations
                      ? integrations.channel3.configured
                        ? "Key configured on server"
                        : "Key not configured"
                      : "Status unavailable"}
                  </strong>
                  <p>Each live search checks the connection.</p>
                </div>
                <button
                  className="button secondary compact"
                  type="button"
                  disabled={healthPending}
                  onClick={() => setHealthVersion((v) => v + 1)}
                >
                  <RefreshCw size={14} aria-hidden="true" />{" "}
                  {healthPending ? "Checking…" : "Check status"}
                </button>
              </section>
              <section className="op-rail-context">
                <h2>
                  <ShieldCheck size={18} aria-hidden="true" /> Authorization
                </h2>
                <p>
                  The Firewall checks each proposal against the mandate.
                  Eligible seeded products can proceed to sandbox checkout.
                </p>
                <dl className="op-context-refs">
                  <dt>Local owner</dt>
                  <dd>{integrations?.identity.owner_id ?? "Unavailable"}</dd>
                  <dt>Agent</dt>
                  <dd>{integrations?.identity.agent_id ?? "Unavailable"}</dd>
                </dl>
                <small>
                  These identities come from local configuration. The agent can
                  only recommend products.
                </small>
              </section>
            </aside>
          </div>
          {pending && (
            <p className="execution-progress" role="status">
              Research is in progress. Runs can take up to four minutes. Open
              Black Box to follow incoming events.
            </p>
          )}
          {execution && <ShoppingResults execution={execution} />}
        </main>
      </div>
    </div>
  );
}
