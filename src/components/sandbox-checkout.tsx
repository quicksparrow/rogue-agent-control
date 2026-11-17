"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import type { PaymentOperation, PaymentView } from "../lib/payment-contracts";
const operationLabels: Record<PaymentOperation, string> = {
  create: "Creating order…",
  verify: "Verifying order…",
  capture: "Submitting capture…",
  cancel: "Cancelling locally…",
  retry_create: "Retrying order request…",
};

export default function SandboxCheckout({
  proposalId,
  returnFlow = false,
  cancelFlow = false,
}: {
  proposalId: string;
  returnFlow?: boolean;
  cancelFlow?: boolean;
}) {
  const [view, setView] = useState<PaymentView | null>(null),
    [activeOperation, setActiveOperation] = useState<PaymentOperation | null>(
      null,
    ),
    [error, setError] = useState("");
  const operationLock = useRef(false);
  const pending = activeOperation !== null;
  useEffect(() => {
    setView(null);
    setError("");
    let current = true;
    void fetch(
      `/api/gateway/paypal?proposal_id=${encodeURIComponent(proposalId)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Sandbox status unavailable");
        if (current) setView(body.payment);
      })
      .catch(() => {
        if (current)
          setError(
            "Sandbox checkout status unavailable; execution remains blocked.",
          );
      });
    return () => {
      current = false;
    };
  }, [proposalId]);
  async function operate(operation: PaymentOperation) {
    if (operationLock.current) return;
    operationLock.current = true;
    setActiveOperation(operation);
    setError("");
    try {
      const r = await fetch("/api/gateway/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_id: proposalId, operation }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Sandbox operation failed");
      setView(body.payment);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Sandbox operation unavailable; check evidence.",
      );
    } finally {
      operationLock.current = false;
      setActiveOperation(null);
    }
  }
  return (
    <section
      className="sandbox-checkout payment-panel"
      aria-label="Sandbox checkout"
    >
      <div className="firewall-status-heading">
        <ShieldCheck size={17} />
        <strong>Sandbox checkout. No real money.</strong>
      </div>
      <p className="form-note">
        Sandbox orders use seeded products and a test seller. Retailer
        fulfillment, tax and shipping are outside this simulation.
      </p>
      {returnFlow && (
        <p className="form-note">
          {cancelFlow
            ? "The URL indicates cancellation. Confirm below to cancel locally. The provider keeps its last recorded order status."
            : "Verify the order with the sandbox provider before capture. A return link alone cannot confirm buyer approval."}
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {!view && !error && (
        <p role="status">Checking trusted sandbox eligibility…</p>
      )}
      {view && (
        <>
          <div className="sandbox-state" role="status">
            <div>
              <span>Checkout state</span>
              <strong>{view.state.replaceAll("_", " ")}</strong>
            </div>
            <div>
              <span>Provider order status</span>
              <strong>{view.provider_status ?? "Not contacted"}</strong>
            </div>
            <div>
              <span>Capture</span>
              <strong data-confirmed={view.payment_captured}>
                {view.payment_captured
                  ? "Sandbox capture confirmed"
                  : "No confirmed capture"}
              </strong>
            </div>
          </div>
          {!view.available && (
            <p className="form-note">
              Checkout unavailable: {view.error_code}.{" "}
              {view.reason_codes.join(" · ")}. DENY and REVIEW cannot invoke
              the sandbox provider.
            </p>
          )}
          {view.error_code && view.available && (
            <p className="form-note">
              {view.error_code}
              {view.provider_error_code ? ` · ${view.provider_error_code}` : ""}
              . Inspect Black Box before retrying.
            </p>
          )}
          {view.state === "unknown_reconciling" && (
            <p className="form-note">
              Provider outcome unknown. Do not create another mandate to retry
              this payment. Known orders can be looked up; capture is never
              resubmitted automatically.
            </p>
          )}
          {view.order_id && (
            <dl className="product-references">
              <dt>Sandbox order</dt>
              <dd>{view.order_id}</dd>
              <dt>Provider state</dt>
              <dd>{view.provider_status ?? "unknown"}</dd>
              {view.capture_id && (
                <>
                  <dt>Sandbox capture</dt>
                  <dd>{view.capture_id}</dd>
                  <dt>Capture status</dt>
                  <dd>{view.capture_status ?? "not recorded"}</dd>
                </>
              )}
              {view.approval_verified_at && (
                <>
                  <dt>Approval verified</dt>
                  <dd>{view.approval_verified_at}</dd>
                </>
              )}
            </dl>
          )}
          <div className="sandbox-actions">
            {view.can_create && (
              <button
                type="button"
                className="button primary"
                disabled={pending}
                onClick={() => void operate("create")}
              >
                {activeOperation === "create"
                  ? operationLabels.create
                  : "Create Sandbox Order"}
              </button>
            )}
            {view.available && view.approval_url && (
              <a
                className="button secondary"
                href={view.approval_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Approve with Sandbox Buyer <ExternalLink size={13} />
              </a>
            )}
            {view.can_verify && (
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => void operate("verify")}
              >
                <RefreshCw size={13} />
                {activeOperation === "verify"
                  ? operationLabels.verify
                  : "Verify / reconcile order"}
              </button>
            )}
            {view.can_capture && (
              <button
                type="button"
                className="button primary"
                disabled={pending}
                onClick={() => void operate("capture")}
              >
                {activeOperation === "capture"
                  ? operationLabels.capture
                  : "Capture Sandbox Payment"}
              </button>
            )}
            {view.can_cancel && (
              <button
                type="button"
                className="button secondary op-cancel"
                disabled={pending}
                onClick={() => void operate("cancel")}
              >
                {activeOperation === "cancel"
                  ? operationLabels.cancel
                  : "Cancel locally"}
              </button>
            )}
            {view.can_retry_create && (
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => void operate("retry_create")}
              >
                {activeOperation === "retry_create"
                  ? operationLabels.retry_create
                  : "Retry same Sandbox Order request"}
              </button>
            )}
          </div>
          <a
            className="op-evidence-link"
            href={`/?run=${encodeURIComponent(view.run_id)}`}
          >
            Inspect payment evidence in Black Box
          </a>
          <details>
            <summary>Sandbox mapping and operation references</summary>
            <dl className="product-references">
              <dt>Proposal</dt>
              <dd>{view.proposal_id}</dd>
              <dt>Seller mapping</dt>
              <dd>{view.seller_mapping_version ?? "not claimed"}</dd>
              <dt>Create idempotency ID</dt>
              <dd>{view.create_request_id ?? "not claimed"}</dd>
              <dt>Capture idempotency ID</dt>
              <dd>{view.capture_request_id ?? "not claimed"}</dd>
            </dl>
          </details>
        </>
      )}
    </section>
  );
}
