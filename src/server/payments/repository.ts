import type { BlackBoxStore } from "../store";
import type { PaymentRecord } from "../../lib/payment-contracts";
import { PaymentError } from "./config";
export function readPayment(
  store: BlackBoxStore,
  proposalId: string,
): PaymentRecord | null {
  const row = store.db
    .prepare(
      "SELECT record_json,context_json FROM sandbox_payments WHERE proposal_id=?",
    )
    .get(proposalId) as
    | { record_json: string; context_json: string }
    | undefined;
  if (!row) return null;
  const p = JSON.parse(row.record_json) as PaymentRecord;
  if (
    JSON.stringify(p.context) !== row.context_json ||
    p.proposal_id !== proposalId ||
    p.context.proposal_id !== p.proposal_id ||
    p.context.run_id !== p.run_id ||
    p.context.mandate_id !== p.mandate_id
  )
    throw new PaymentError("CONTEXT_INVALID", 503);
  return p;
}
export function savePayment(store: BlackBoxStore, payment: PaymentRecord) {
  payment.updated_at = new Date().toISOString();
  const result = store.db
    .prepare(
      "UPDATE sandbox_payments SET record_json=? WHERE proposal_id=? AND context_json=?",
    )
    .run(
      JSON.stringify(payment),
      payment.proposal_id,
      JSON.stringify(payment.context),
    );
  if (result.changes !== 1) throw new PaymentError("STORAGE_UNAVAILABLE", 503);
}
