"use client";
import {
  ArrowRight,
  Check,
  Database,
  ExternalLink,
  TriangleAlert,
} from "lucide-react";
import { money } from "../lib/evidence";
import type { ShoppingExecution } from "../lib/shopping-contracts";
import { errorMessages, type ErrorCode } from "../server/shopping/errors";
import FirewallStatus from "./firewall-status";

export default function ShoppingResults({
  execution,
  includeBlackBoxLink = true,
}: {
  execution: ShoppingExecution;
  includeBlackBoxLink?: boolean;
}) {
  const failure = execution.error_code
    ? (errorMessages[execution.error_code as ErrorCode] ??
      "Execution failed. Inspect the Black Box evidence.")
    : null;
  return (
    <section className="shopping-results" aria-label="Shopping results">
      <div className="shopping-result-heading">
        <div>
          <span className="eyebrow">
            Owner mandate · <code>{execution.policy.version.slice(0, 11)}</code>
          </span>
          <h2>
            {execution.evidence_mode === "synthetic_fixture"
              ? "Controlled policy fixture"
              : execution.status === "completed"
                ? "Model recommendations"
                : execution.status === "failed"
                  ? "Execution failed"
                  : "Execution pending / unfinished"}
          </h2>
        </div>
        {includeBlackBoxLink && (
          <a
            className="button secondary"
            href={`/?run=${encodeURIComponent(execution.run_id)}`}
          >
            Open Black Box
            <ArrowRight size={15} />
          </a>
        )}
      </div>
      <p className="saved-objective">{execution.mandate.objective}</p>
      <div className="result-badges">
        <span className="badge neutral">
          {execution.mandate.catalog_mode === "offline"
            ? "SEEDED CATALOG SELECTED"
            : "CHANNEL3 LIVE SELECTED"}
        </span>
        <span
          className={`badge ${execution.evidence_mode === "synthetic_fixture" ? "synthetic" : "neutral"}`}
        >
          {execution.evidence_mode === "synthetic_fixture"
            ? "Synthetic proposal"
            : execution.status === "completed"
              ? "Local model"
              : "See model status in Black Box"}
        </span>
        <span className="badge neutral">
          {execution.firewall ? "Policy attached" : "Recommendations only"}
        </span>
      </div>
      {execution.mandate.omitted_sensitive_fields > 0 && (
        <p className="form-note">
          Sensitive patterns were omitted from{" "}
          {execution.mandate.omitted_sensitive_fields} mandate fields before
          saving.
        </p>
      )}
      {failure && (
        <div className="error-banner" role="alert">
          <TriangleAlert size={17} />
          <span>
            {failure}
            <br />
            <small>
              Code: {execution.error_code}. The selected catalog mode was
              retained.
            </small>
          </span>
        </div>
      )}
      {execution.status === "completed" &&
        !execution.recommendations.length && (
          <p className="no-match">
            The actual model returned no matching recommendation. Captured
            catalog products and execution evidence remain available in Black
            Box.
          </p>
        )}
      <div className="recommendation-list">
        {execution.recommendations.map((r, index) => {
          const comparisons = [
            ...new Set([
              ...r.discrepancies,
              ...(r.quantity !== execution.mandate.quantity
                ? ["quantity_differs"]
                : []),
              ...(r.total_amount_minor > execution.mandate.budget_minor
                ? ["above_budget"]
                : []),
            ]),
          ];
          return (
            <article key={r.product.product_id} className="recommendation-card">
              <div className="recommendation-top">
                <span className="eyebrow">Alternative {index + 1}</span>
                <span className="badge neutral">
                  {r.product.availability.replaceAll("_", " ").toUpperCase()}
                </span>
              </div>
              <h3>{r.product.title}</h3>
              <p className="merchant-reference">
                <code>{r.product.merchant_id}</code> · Provider identity
                unverified
              </p>
              <div className="recommendation-price">
                <strong>
                  {money(r.total_amount_minor, r.product.currency)}
                </strong>
                <span>
                  estimated total
                  <br />
                  {r.quantity} ×{" "}
                  {money(r.product.unit_amount_minor, r.product.currency)}
                </span>
              </div>
              <p className="form-note">
                {execution.evidence_mode === "synthetic_fixture"
                  ? "Fixture"
                  : "Model"}{" "}
                rationale codes: {r.reason_codes.join(", ")}.{" "}
                {execution.evidence_mode === "synthetic_fixture"
                  ? "Static test data, not AI output."
                  : "These codes are model claims."}
              </p>
              {comparisons.length ? (
                <div className="reference-warnings">
                  <TriangleAlert size={15} />
                  <span>
                    {comparisons.map((s) => s.replaceAll("_", " ")).join(" · ")}
                    <small>
                      Original recommendation retained.{" "}
                      {execution.firewall
                        ? "The independent Firewall decision is shown below."
                        : "No firewall was attached to this historical run."}
                    </small>
                  </span>
                </div>
              ) : (
                <p className="reference-check">
                  <Check size={14} />
                  No differences in checked budget, quantity, currency, merchant
                  and availability fields.
                </p>
              )}
              <details>
                <summary>Product evidence & source</summary>
                <dl className="product-references">
                  <dt>Internal offer ID</dt>
                  <dd>{r.product.product_id}</dd>
                  <dt>Source product ID</dt>
                  <dd>{r.product.source_product_id}</dd>
                  <dt>Catalog</dt>
                  <dd>
                    {r.product.source === "offline"
                      ? "Seeded catalog v1"
                      : "Channel3 live search"}
                  </dd>
                  <dt>Reference</dt>
                  <dd>
                    {r.product.source === "channel3" ? (
                      <a
                        href={r.product.source_reference}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View product reference
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      r.product.source_reference
                    )}
                  </dd>
                </dl>
              </details>
            </article>
          );
        })}
      </div>
      <FirewallStatus
        view={execution.firewall}
        fixture={execution.evidence_mode === "synthetic_fixture"}
      />
      <p className="results-boundary">
        <Database size={14} />
        Each alternative is priced separately. Estimates exclude tax and
        shipping. Variant availability and bulk stock require verification.
      </p>
      <details className="mandate-details">
        <summary>Mandate, policy version & identity attribution</summary>
        <dl className="product-references">
          <dt>Mandate ID</dt>
          <dd>{execution.mandate.mandate_id}</dd>
          <dt>Policy version</dt>
          <dd>{execution.policy.version}</dd>
          <dt>Reference limit</dt>
          <dd>
            {money(execution.policy.max_total_minor, execution.policy.currency)}
          </dd>
          <dt>Quantity</dt>
          <dd>{execution.mandate.quantity}</dd>
          <dt>Owner / agent</dt>
          <dd>
            {execution.mandate.identity.owner_id} /{" "}
            {execution.mandate.identity.agent_id}
          </dd>
          <dt>Attribution</dt>
          <dd>
            Local application configuration; no authenticated human or
            cryptographic model identity is asserted.
          </dd>
          <dt>Authorized context</dt>
          <dd>
            {execution.mandate.identity.authorized_context.replaceAll("_", " ")}
          </dd>
        </dl>
      </details>
    </section>
  );
}
