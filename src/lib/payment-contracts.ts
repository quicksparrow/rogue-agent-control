import { z } from "zod";
import { identifier, currency } from "./contracts";
import type { PaymentState, PaymentErrorCode } from "./payment-vocabulary";
export const paymentRequestSchema = z
  .object({
    proposal_id: identifier,
    operation: z.enum([
      "create",
      "verify",
      "capture",
      "cancel",
      "retry_create",
    ]),
  })
  .strict();
export type PaymentOperation = z.infer<
  typeof paymentRequestSchema
>["operation"];
export const paypalId = z.string().regex(/^[A-Z0-9]{10,32}$/);
export const sellerId = z.string().regex(/^[2-9A-HJ-NP-Z]{13}$/);
export function paypalDecimal(minor: number, code: unknown): string {
  currency.parse(code);
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 1_000_000_000)
    throw new Error("Invalid minor-unit amount");
  const n = BigInt(minor);
  return `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}
export interface PaymentContext {
  proposal_id: string;
  run_id: string;
  mandate_id: string;
  owner_id: string;
  decision_id: string;
  policy_version: string;
  owner_policy_version: string;
  registry_version: string;
  catalog_merchant_id: string;
  application_merchant_id: string;
  seller_merchant_id: string;
  seller_mapping_version: string;
  terms_version: "seed_sandbox_terms_v1";
  return_base_url: string;
  product_id: string;
  source_product_id: string;
  quantity: number;
  currency: string;
  unit_amount_minor: number;
  total_amount_minor: number;
}
export interface PaymentRecord {
  payment_id: string;
  proposal_id: string;
  run_id: string;
  mandate_id: string;
  context: PaymentContext;
  state: PaymentState;
  provider_status: string | null;
  capture_status?: string | null;
  order_id: string | null;
  capture_id: string | null;
  approval_url: string | null;
  create_request_id: string;
  capture_request_id: string;
  created_at: string;
  updated_at: string;
  create_started_at: string | null;
  capture_started_at: string | null;
  create_attempts: number;
  capture_attempts: number;
  error_code: PaymentErrorCode | null;
  provider_error_code: string | null;
  approval_verified_at: string | null;
  cancel_requested: boolean;
  active_operation: PaymentOperation | null;
  operation_token: string | null;
}
export interface PaymentView {
  proposal_id: string;
  run_id: string;
  state: PaymentState;
  available: boolean;
  reason_codes: string[];
  sandbox: true;
  no_real_money: true;
  retailer_fulfillment: false;
  order_id: string | null;
  capture_id: string | null;
  provider_status: string | null;
  capture_status: string | null;
  approval_url: string | null;
  seller_mapping_version: string | null;
  create_request_id: string | null;
  capture_request_id: string | null;
  error_code: PaymentErrorCode | null;
  provider_error_code: string | null;
  approval_verified_at: string | null;
  can_create: boolean;
  can_verify: boolean;
  can_capture: boolean;
  can_cancel: boolean;
  can_retry_create: boolean;
  payment_captured: boolean;
}
