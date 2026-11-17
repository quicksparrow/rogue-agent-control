import { createHash, randomUUID } from "node:crypto";
import {
  paymentRequestSchema,
  type PaymentContext,
  type PaymentOperation,
  type PaymentRecord,
  type PaymentView,
} from "../../lib/payment-contracts";
import type { BlackBoxStore } from "../store";
import { StoreError } from "../store";
import { getProposal, requireCurrentAllowance } from "../firewall/gateway";
import { PaymentError, sandboxConfig } from "./config";
import { trustedPaymentContext } from "./context";
import { readPayment, savePayment } from "./repository";
import { SandboxPayPal, type ObservedOrder, type PayPalAudit } from "./paypal";
import { recordPaymentEvent } from "./trace";

// Less than the documented six-hour retention, with a safety margin. Never automatically retry POST.
export const CREATE_RETRY_WINDOW_MS = (5 * 60 + 55) * 60 * 1000;
const OPERATION_LEASE_MS = 120000;
type Provider = Pick<SandboxPayPal, "create" | "lookup" | "capture">;
const clients = new Map<string, SandboxPayPal>();
function client(): SandboxPayPal {
  if (process.env.NODE_ENV === "test")
    throw new PaymentError("NOT_CONFIGURED", 503);
  const config = sandboxConfig(),
    key = createHash("sha256")
      .update(
        config.clientId +
          ":" +
          config.clientSecret +
          ":" +
          config.mappingVersion,
      )
      .digest("hex");
  let adapter = clients.get(key);
  if (!adapter) {
    if (clients.size > 8) clients.clear();
    adapter = new SandboxPayPal(config);
    clients.set(key, adapter);
  }
  return adapter;
}
function freshContext(store: BlackBoxStore, p: PaymentRecord): PaymentContext {
  const current = trustedPaymentContext(store, p.proposal_id);
  if (JSON.stringify(current) !== JSON.stringify(p.context))
    throw new PaymentError("CONTEXT_CHANGED", 503);
  const mapping = store.db
    .prepare("SELECT record_json FROM sandbox_seller_mappings WHERE version=?")
    .get(current.seller_mapping_version) as { record_json: string } | undefined;
  if (
    !mapping ||
    mapping.record_json !==
      JSON.stringify({
        version: current.seller_mapping_version,
        seller_merchant_id: current.seller_merchant_id,
        demo_merchant_ids: sandboxConfig().demoMerchantIds,
        terms_version: current.terms_version,
        sandbox: true,
        retailer_fulfillment: false,
      })
  )
    throw new PaymentError("SELLER_UNMAPPED", 503);
  return current;
}
function stateEvent(store: BlackBoxStore, p: PaymentRecord, provider = false) {
  recordPaymentEvent(
    store,
    p.run_id,
    "payment_state_changed",
    {
      proposal_id: p.proposal_id,
      payment_id: p.payment_id,
      state: p.state,
      provider_status: p.provider_status,
      capture_status: p.capture_status ?? null,
      order_id: p.order_id,
      capture_id: p.capture_id,
      error_code: p.error_code,
      cancel_requested: p.cancel_requested,
      sandbox: true,
      retailer_fulfillment: false,
    },
    provider,
  );
}
function transition(
  store: BlackBoxStore,
  p: PaymentRecord,
  state: PaymentRecord["state"],
  provider = false,
) {
  p.state = state;
  savePayment(store, p);
  stateEvent(store, p, provider);
}
export function paymentView(
  store: BlackBoxStore,
  proposalId: string,
): PaymentView {
  const proposal = getProposal(store, proposalId);
  let saved = readPayment(store, proposalId);
  if (
    saved?.active_operation &&
    Date.now() - Date.parse(saved.updated_at) > OPERATION_LEASE_MS
  ) {
    saved = store.db
      .transaction(() => {
        const current = readPayment(store, proposalId)!;
        if (
          current.active_operation &&
          Date.now() - Date.parse(current.updated_at) > OPERATION_LEASE_MS
        ) {
          current.active_operation = null;
          current.operation_token = null;
          current.error_code = "OPERATION_PENDING";
          transition(store, current, "unknown_reconciling");
        }
        return current;
      })
      .immediate();
  }
  let available = false,
    error: PaymentRecord["error_code"] = null,
    reasons: string[] = [];
  let policyOutcome = "DENY";
  try {
    const result = requireCurrentAllowance(store, proposalId);
    policyOutcome = result.decision.outcome;
    reasons = result.decision.reason_codes;
    if (policyOutcome !== "ALLOW")
      throw new PaymentError(
        policyOutcome === "REVIEW" ? "OWNER_REVIEW_PENDING" : "POLICY_BLOCKED",
      );
    if (saved) freshContext(store, saved);
    else trustedPaymentContext(store, proposalId);
    available = true;
  } catch (e) {
    error = e instanceof PaymentError ? e.code : "CONTEXT_INVALID";
  }
  const state =
    saved?.state ??
    (policyOutcome === "REVIEW"
      ? "review_pending"
      : policyOutcome === "ALLOW"
        ? error === "SYNTHETIC_NOT_EXECUTABLE"
          ? "blocked"
          : "eligible"
        : "blocked");
  const busy = Boolean(saved?.active_operation);
  const retry = Boolean(
    saved &&
      !saved.order_id &&
      !saved.cancel_requested &&
      ["unknown_reconciling", "failed"].includes(saved.state) &&
      saved.create_started_at &&
      Date.now() - Date.parse(saved.create_started_at) < CREATE_RETRY_WINDOW_MS,
  );
  return {
    proposal_id: proposalId,
    run_id: proposal.run_id,
    state,
    available,
    reason_codes: reasons,
    sandbox: true,
    no_real_money: true,
    retailer_fulfillment: false,
    order_id: saved?.order_id ?? null,
    capture_id: saved?.capture_id ?? null,
    provider_status: saved?.provider_status ?? null,
    capture_status: saved?.capture_status ?? null,
    approval_url:
      saved &&
      !saved.cancel_requested &&
      !saved.capture_attempts &&
      !["buyer_approved", "captured"].includes(saved.state)
        ? saved.approval_url
        : null,
    seller_mapping_version: saved?.context.seller_mapping_version ?? null,
    create_request_id: saved?.create_request_id ?? null,
    capture_request_id: saved?.capture_request_id ?? null,
    error_code: error ?? saved?.error_code ?? null,
    provider_error_code: saved?.provider_error_code ?? null,
    approval_verified_at: saved?.approval_verified_at ?? null,
    can_create: available && !saved,
    can_verify:
      available &&
      state !== "captured" &&
      Boolean(saved?.order_id) &&
      (!busy ||
        Date.now() - Date.parse(saved!.updated_at) > OPERATION_LEASE_MS),
    can_capture:
      available &&
      !busy &&
      state === "buyer_approved" &&
      !saved?.cancel_requested &&
      !saved?.capture_attempts,
    can_cancel:
      available &&
      !busy &&
      Boolean(saved) &&
      !saved?.capture_attempts &&
      !saved?.cancel_requested &&
      state !== "captured",
    can_retry_create:
      available &&
      retry &&
      (!busy ||
        Date.now() - Date.parse(saved!.updated_at) > OPERATION_LEASE_MS),
    payment_captured: state === "captured",
  };
}
/** Only a stored reference and explicit local-user operation enter this financial boundary. */
export function sandboxGateway(store: BlackBoxStore, testProvider?: Provider) {
  if (
    testProvider &&
    (process.env.NODE_ENV !== "test" || store.db.name !== ":memory:")
  )
    throw new PaymentError("SANDBOX_ONLY", 403);
  async function operate(raw: unknown): Promise<PaymentView> {
    const input = paymentRequestSchema.parse(raw),
      context = trustedPaymentContext(store, input.proposal_id);
    const provider = testProvider ?? client();
    let payment = readPayment(store, input.proposal_id);
    if (payment) freshContext(store, payment);
    if (input.operation === "create") {
      const claimed = store.db
        .transaction(() => {
          const prior = readPayment(store, input.proposal_id);
          if (prior) return { payment: prior, fresh: false };
          const checked = trustedPaymentContext(store, input.proposal_id);
          if (JSON.stringify(checked) !== JSON.stringify(context))
            throw new PaymentError("CONTEXT_CHANGED", 503);
          if (
            store.db
              .prepare(
                "SELECT 1 FROM gateway_claims WHERE run_id=? OR mandate_id=?",
              )
              .get(context.run_id, context.mandate_id) ||
            store.db
              .prepare(
                "SELECT 1 FROM sandbox_payments WHERE run_id=? OR mandate_id=?",
              )
              .get(context.run_id, context.mandate_id)
          )
            throw new PaymentError("CONTEXT_INVALID");
          const now = new Date().toISOString();
          const p: PaymentRecord = {
            payment_id: `payment_${randomUUID()}`,
            proposal_id: input.proposal_id,
            run_id: context.run_id,
            mandate_id: context.mandate_id,
            context,
            state: "proposed",
            provider_status: null,
            capture_status: null,
            order_id: null,
            capture_id: null,
            approval_url: null,
            create_request_id: randomUUID(),
            capture_request_id: randomUUID(),
            created_at: now,
            updated_at: now,
            create_started_at: now,
            capture_started_at: null,
            create_attempts: 1,
            capture_attempts: 0,
            error_code: null,
            provider_error_code: null,
            approval_verified_at: null,
            cancel_requested: false,
            active_operation: "create",
            operation_token: randomUUID(),
          };
          store.db
            .prepare(
              "INSERT OR IGNORE INTO sandbox_seller_mappings VALUES(?,?)",
            )
            .run(
              context.seller_mapping_version,
              JSON.stringify({
                version: context.seller_mapping_version,
                seller_merchant_id: context.seller_merchant_id,
                demo_merchant_ids: sandboxConfig().demoMerchantIds,
                terms_version: context.terms_version,
                sandbox: true,
                retailer_fulfillment: false,
              }),
            );
          store.db
            .prepare("INSERT INTO sandbox_payments VALUES(?,?,?,?,?,?)")
            .run(
              p.payment_id,
              p.proposal_id,
              p.run_id,
              p.mandate_id,
              JSON.stringify(context),
              JSON.stringify(p),
            );
          recordPaymentEvent(store, p.run_id, "payment_claimed", {
            proposal_id: p.proposal_id,
            payment_id: p.payment_id,
            mandate_id: p.mandate_id,
            decision_id: context.decision_id,
            seller_mapping_version: context.seller_mapping_version,
            catalog_merchant_id: context.catalog_merchant_id,
            application_merchant_id: context.application_merchant_id,
            terms_version: context.terms_version,
            currency: context.currency,
            unit_amount_minor: context.unit_amount_minor,
            total_amount_minor: context.total_amount_minor,
            quantity: context.quantity,
            request_id: p.create_request_id,
            sandbox: true,
            retailer_fulfillment: false,
          });
          stateEvent(store, p);
          transition(store, p, "eligible");
          transition(store, p, "order_creating");
          return { payment: p, fresh: true };
        })
        .immediate();
      payment = claimed.payment;
      if (!claimed.fresh) return paymentView(store, input.proposal_id);
    } else {
      if (!payment) throw new PaymentError("UNKNOWN_ORDER_ID");
      payment = store.db
        .transaction(() => {
          const p = readPayment(store, input.proposal_id)!;
          freshContext(store, p);
          if (
            p.active_operation &&
            Date.now() - Date.parse(p.updated_at) <= OPERATION_LEASE_MS
          )
            return null;
          if (
            p.active_operation &&
            !["verify", "retry_create"].includes(input.operation)
          )
            throw new PaymentError("OPERATION_PENDING");
          if (p.state === "captured" && input.operation !== "verify")
            return null;
          if (input.operation === "retry_create") {
            if (
              p.order_id ||
              p.cancel_requested ||
              p.capture_attempts ||
              !p.create_started_at ||
              !["failed", "unknown_reconciling", "order_creating"].includes(
                p.state,
              )
            )
              throw new PaymentError("CONTEXT_INVALID");
            if (
              Date.now() - Date.parse(p.create_started_at) >=
              CREATE_RETRY_WINDOW_MS
            )
              throw new PaymentError("RETRY_WINDOW_EXPIRED");
            p.create_attempts++;
            p.error_code = null;
            p.provider_error_code = null;
          } else if (!p.order_id) throw new PaymentError("UNKNOWN_ORDER_ID");
          if (
            input.operation === "capture" &&
            (p.cancel_requested ||
              p.capture_attempts ||
              p.state !== "buyer_approved" ||
              !p.approval_verified_at)
          )
            throw new PaymentError("APPROVAL_NOT_VERIFIED");
          if (
            input.operation === "cancel" &&
            (p.capture_attempts || p.cancel_requested)
          )
            throw new PaymentError("CONTEXT_INVALID");
          p.active_operation = input.operation;
          p.operation_token = randomUUID();
          savePayment(store, p);
          if (input.operation === "retry_create")
            transition(store, p, "order_creating");
          return p;
        })
        .immediate();
      if (!payment) return paymentView(store, input.proposal_id);
    }
    const p = payment,
      token = p.operation_token;
    const guard = () => {
      const current = readPayment(store, p.proposal_id);
      if (
        !current ||
        current.operation_token !== token ||
        current.active_operation !== input.operation
      )
        throw new PaymentError("CONTEXT_CHANGED", 503);
      freshContext(store, current);
    };
    const responseGuard = () => {
      const current = readPayment(store, p.proposal_id);
      if (!current || current.operation_token !== token)
        throw new PaymentError("CONTEXT_CHANGED", 503, null, true);
    };
    // retry_create is the same logical create operation, with its original request ID and body.
    const expectedOperation =
      input.operation === "retry_create" ? "retry_create" : input.operation;
    p.active_operation = expectedOperation;
    const oauth: PayPalAudit = (stage, code) => {
      recordPaymentEvent(
        store,
        p.run_id,
        "paypal_oauth",
        {
          proposal_id: p.proposal_id,
          payment_id: p.payment_id,
          stage,
          error_code: code ?? null,
        },
        stage !== "requested",
      );
    };
    const event = (
      operation: "create" | "lookup" | "capture",
      stage: "requested" | "completed" | "failed",
      error: PaymentError | null = null,
    ) =>
      recordPaymentEvent(
        store,
        p.run_id,
        "paypal_operation",
        {
          proposal_id: p.proposal_id,
          payment_id: p.payment_id,
          operation,
          stage,
          request_id:
            operation === "create"
              ? p.create_request_id
              : operation === "capture"
                ? p.capture_request_id
                : null,
          order_id: p.order_id,
          provider_status: p.provider_status,
          capture_status: p.capture_status ?? null,
          error_code: error?.code ?? null,
          provider_error_code: error?.providerCode ?? null,
        },
        stage !== "requested",
      );
    const observe = (o: ObservedOrder) => {
      p.order_id = o.order_id;
      p.provider_status = o.status;
      p.approval_url = o.approval_url ?? p.approval_url;
      p.capture_id = o.capture_id ?? p.capture_id;
      p.capture_status = o.capture_status ?? p.capture_status ?? null;
      if (
        o.status === "COMPLETED" &&
        o.capture_status === "COMPLETED" &&
        o.capture_id
      ) {
        p.error_code = null;
        p.provider_error_code = null;
        transition(store, p, "captured", true);
        return;
      }
      if (o.capture_id || o.status === "COMPLETED") {
        transition(store, p, "unknown_reconciling", true);
        return;
      }
      if (p.capture_attempts) {
        transition(store, p, "unknown_reconciling", true);
        return;
      }
      if (p.cancel_requested || o.status === "VOIDED") {
        transition(store, p, "cancelled", true);
        return;
      }
      if (o.status === "APPROVED") {
        p.error_code = null;
        p.provider_error_code = null;
        p.approval_verified_at = new Date().toISOString();
        transition(store, p, "buyer_approved", true);
        return;
      }
      p.approval_verified_at = null;
      if (["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(o.status)) {
        p.error_code = null;
        p.provider_error_code = null;
        transition(store, p, "order_created", true);
        transition(store, p, "buyer_approval_pending", true);
      }
    };
    let operation: "create" | "lookup" | "capture" =
      input.operation === "create" || input.operation === "retry_create"
        ? "create"
        : "lookup";
    try {
      guard();
      event(operation, "requested");
      if (operation === "create") {
        const observed = await provider.create(
          p.context,
          p.create_request_id,
          oauth,
          guard,
        );
        responseGuard();
        store.db.transaction(() => {
          observe(observed);
          event("create", "completed");
        })();
      } else {
        const observed = await provider.lookup(
          p.context,
          p.order_id!,
          oauth,
          guard,
        );
        responseGuard();
        store.db.transaction(() => {
          observe(observed);
          event("lookup", "completed");
        })();
        if (input.operation === "cancel") {
          store.db.transaction(() => {
            if (p.state !== "captured") {
              p.cancel_requested = true;
              p.error_code = "CANCELLED_LOCALLY";
              transition(store, p, "cancelled");
            }
          })();
        }
        if (input.operation === "capture" && p.state !== "captured") {
          if (
            observed.status !== "APPROVED" ||
            observed.capture_id ||
            p.state !== "buyer_approved" ||
            p.cancel_requested
          )
            throw new PaymentError("APPROVAL_NOT_VERIFIED");
          guard();
          store.db.transaction(() => {
            guard();
            p.capture_attempts = 1;
            p.capture_started_at = new Date().toISOString();
            transition(store, p, "capture_pending");
            event("capture", "requested");
          })();
          operation = "capture";
          const captured = await provider.capture(
            p.context,
            p.order_id!,
            p.capture_request_id,
            oauth,
            guard,
          );
          responseGuard();
          store.db.transaction(() => {
            observe(captured);
            event("capture", "completed");
          })();
        }
      }
      store.db.transaction(() => {
        p.active_operation = null;
        p.operation_token = null;
        savePayment(store, p);
      })();
    } catch (error) {
      const safe =
        error instanceof PaymentError
          ? error
          : new PaymentError(
              error instanceof StoreError
                ? "CONTEXT_INVALID"
                : "PROVIDER_UNAVAILABLE",
              503,
              null,
              true,
            );
      // Once a capture was submitted, only read-only reconciliation is permitted, even after a definite error.
      try {
        store.db.transaction(() => {
          const current = readPayment(store, p.proposal_id);
          if (!current || current.operation_token !== token)
            throw new PaymentError("CONTEXT_CHANGED", 503);
          p.error_code = safe.code;
          if (!p.order_id && safe.orderId) p.order_id = safe.orderId;
          p.provider_error_code = safe.providerCode;
          p.active_operation = null;
          p.operation_token = null;
          event(operation, "failed", safe);
          transition(
            store,
            p,
            p.state === "captured" || safe.code === "APPROVAL_NOT_VERIFIED"
              ? p.state
              : safe.ambiguous ||
                  p.capture_attempts > 0 ||
                  (operation === "lookup" && Boolean(p.order_id))
                ? "unknown_reconciling"
                : "failed",
          );
        })();
      } catch {
        throw new PaymentError("STORAGE_UNAVAILABLE", 503);
      }
    }
    return paymentView(store, input.proposal_id);
  }
  return { operate };
}
