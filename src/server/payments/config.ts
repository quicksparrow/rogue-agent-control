import { createHash } from "node:crypto";
import { sellerId } from "../../lib/payment-contracts";
import type { PaymentErrorCode } from "../../lib/payment-vocabulary";
import { StoreError } from "../store";
export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
export class PaymentError extends StoreError {
  constructor(
    public code: PaymentErrorCode,
    status = 409,
    public providerCode: string | null = null,
    public ambiguous = false,
    public orderId: string | null = null,
  ) {
    super(
      status,
      `Sandbox checkout unavailable: ${code}. No successful payment is implied.`,
    );
  }
}
export interface SandboxConfig {
  clientId: string;
  clientSecret: string;
  sellerMerchantId: string;
  demoMerchantIds: string[];
  returnBaseUrl: string;
  mappingVersion: string;
}
export function sandboxConfig(): SandboxConfig {
  if (
    process.env.PAYPAL_MODE !== "sandbox" ||
    (process.env.PAYPAL_ENVIRONMENT &&
      process.env.PAYPAL_ENVIRONMENT !== "sandbox") ||
    (process.env.PAYPAL_BASE_URL &&
      process.env.PAYPAL_BASE_URL !== PAYPAL_SANDBOX_BASE)
  )
    throw new PaymentError("SANDBOX_ONLY", 503);
  const clientId = process.env.PAYPAL_CLIENT_ID,
    clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (
    !clientId ||
    !clientSecret ||
    !/^[A-Za-z0-9_-]{10,300}$/.test(clientId) ||
    !/^[A-Za-z0-9_-]{10,300}$/.test(clientSecret)
  )
    throw new PaymentError("NOT_CONFIGURED", 503);
  const seller = sellerId.safeParse(process.env.PAYPAL_SANDBOX_MERCHANT_ID);
  const ids = [
    ...new Set(
      (process.env.PAYPAL_SANDBOX_DEMO_MERCHANT_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (
    !seller.success ||
    !ids.length ||
    ids.some(
      (id) =>
        !["demo_sports", "demo_office", "demo_outdoors", "demo_tech"].includes(
          id,
        ),
    )
  )
    throw new PaymentError("SELLER_UNMAPPED", 503);
  const rawBase = process.env.PAYPAL_RETURN_BASE_URL ?? "http://127.0.0.1:3000";
  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    throw new PaymentError("CONTEXT_INVALID", 503);
  }
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  )
    throw new PaymentError("CONTEXT_INVALID", 503);
  const returnBaseUrl = base.origin;
  const mappingVersion = `sandbox_seller_${createHash("sha256")
    .update(
      JSON.stringify([
        clientId,
        seller.data,
        ids,
        returnBaseUrl,
        "seed_sandbox_terms_v1",
      ]),
    )
    .digest("hex")
    .slice(0, 32)}`;
  return {
    clientId,
    clientSecret,
    sellerMerchantId: seller.data,
    demoMerchantIds: ids,
    returnBaseUrl,
    mappingVersion,
  };
}
export function sandboxAvailability() {
  try {
    sandboxConfig();
    return { available: true, error_code: null };
  } catch (error) {
    return {
      available: false,
      error_code:
        error instanceof PaymentError ? error.code : "CONTEXT_INVALID",
    };
  }
}
