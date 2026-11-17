import { z } from "zod";
import {
  paypalDecimal,
  paypalId,
  sellerId,
  type PaymentContext,
} from "../../lib/payment-contracts";
import {
  PAYPAL_SANDBOX_BASE,
  PaymentError,
  type SandboxConfig,
} from "./config";
const statuses = [
  "CREATED",
  "SAVED",
  "APPROVED",
  "VOIDED",
  "COMPLETED",
  "PAYER_ACTION_REQUIRED",
] as const;
const amount = z.object({
  currency_code: z.enum(["USD", "EUR", "GBP", "CAD", "MXN"]),
  value: z.string().regex(/^\d{1,10}\.\d{2}$/),
});
const captureSchema = z.object({
  id: paypalId,
  status: z.enum([
    "COMPLETED",
    "PENDING",
    "DECLINED",
    "FAILED",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
  ]),
  amount,
  final_capture: z.boolean().optional(),
});
const orderSchema = z.object({
  id: paypalId,
  intent: z.literal("CAPTURE"),
  status: z.enum(statuses),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string(),
        custom_id: z.string(),
        amount,
        payee: z.object({ merchant_id: sellerId }),
        items: z
          .array(
            z.object({
              sku: z.string(),
              name: z.string(),
              quantity: z.string(),
              unit_amount: amount,
            }),
          )
          .length(1),
        payments: z
          .object({ captures: z.array(captureSchema).max(2).optional() })
          .optional(),
      }),
    )
    .length(1),
  links: z
    .array(
      z.object({
        href: z.string().max(1000),
        rel: z.string(),
        method: z.string().optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type ObservedOrder = {
  order_id: string;
  status: (typeof statuses)[number];
  approval_url: string | null;
  capture_id: string | null;
  capture_status: string | null;
};
const providerCodes = new Set([
  "INVALID_REQUEST",
  "UNPROCESSABLE_ENTITY",
  "RESOURCE_NOT_FOUND",
  "NOT_AUTHORIZED",
  "PERMISSION_DENIED",
  "AUTHENTICATION_FAILURE",
  "ORDER_NOT_APPROVED",
  "ORDER_ALREADY_CAPTURED",
  "ORDER_ALREADY_AUTHORIZED",
  "PAYEE_ACCOUNT_INVALID",
  "PAYEE_ACCOUNT_RESTRICTED",
  "PAYEE_NOT_CONSENTED",
  "CURRENCY_NOT_SUPPORTED",
  "INSTRUMENT_DECLINED",
  "DUPLICATE_REQUEST_ID",
  "INTERNAL_SERVER_ERROR",
  "INVALID_CLIENT",
  "INVALID_RESOURCE_ID",
]);
function errorCode(body: unknown): string | null {
  const p = body as {
    name?: unknown;
    details?: { issue?: unknown }[];
    error?: unknown;
  } | null;
  const code = p?.details?.[0]?.issue ?? p?.name ?? p?.error;
  return typeof code === "string" && providerCodes.has(code.toUpperCase())
    ? code.toUpperCase()
    : "OTHER_PROVIDER_ERROR";
}
export function inspectOrder(
  raw: unknown,
  context: PaymentContext,
  expectedId?: string,
): ObservedOrder {
  const known = paypalId.safeParse(
    raw && typeof raw === "object" ? (raw as { id?: unknown }).id : null,
  );
  const invalid = (code: "INVALID_PROVIDER_RESPONSE" | "CONTEXT_CHANGED") =>
    new PaymentError(
      code,
      502,
      null,
      true,
      known.success && (!expectedId || expectedId === known.data)
        ? known.data
        : null,
    );
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) throw invalid("INVALID_PROVIDER_RESPONSE");
  const o = parsed.data,
    p = o.purchase_units[0];
  const expected = paypalDecimal(context.total_amount_minor, context.currency),
    unit = paypalDecimal(context.unit_amount_minor, context.currency);
  if (
    (expectedId && o.id !== expectedId) ||
    p.reference_id !== context.proposal_id ||
    p.custom_id !== context.proposal_id ||
    p.amount.value !== expected ||
    p.amount.currency_code !== context.currency ||
    p.payee.merchant_id !== context.seller_merchant_id
  )
    throw invalid("CONTEXT_CHANGED");
  if (
    p.items &&
    (p.items.length !== 1 ||
      p.items[0].sku !== context.source_product_id ||
      p.items[0].quantity !== String(context.quantity) ||
      p.items[0].unit_amount.value !== unit ||
      p.items[0].unit_amount.currency_code !== context.currency)
  )
    throw invalid("CONTEXT_CHANGED");
  const captures = p.payments?.captures ?? [];
  if (
    captures.length > 1 ||
    captures.some(
      (c) =>
        c.amount.value !== expected ||
        c.amount.currency_code !== context.currency ||
        c.final_capture === false,
    )
  )
    throw invalid("CONTEXT_CHANGED");
  const link = o.links?.find(
    (l) =>
      ["approve", "payer-action"].includes(l.rel) &&
      (!l.method || l.method === "GET"),
  );
  let approvalUrl: string | null = null;
  if (link) {
    let u: URL;
    try {
      u = new URL(link.href);
    } catch {
      throw invalid("INVALID_PROVIDER_RESPONSE");
    }
    if (
      u.origin !== "https://www.sandbox.paypal.com" ||
      u.pathname !== "/checkoutnow" ||
      u.username ||
      u.password ||
      u.hash ||
      u.searchParams.get("token") !== o.id ||
      [...u.searchParams.keys()].some((k) => k !== "token")
    )
      throw invalid("INVALID_PROVIDER_RESPONSE");
    approvalUrl = u.href;
  }
  return {
    order_id: o.id,
    status: o.status,
    approval_url: approvalUrl,
    capture_id: captures[0]?.id ?? null,
    capture_status: captures[0]?.status ?? null,
  };
}
export type PayPalAudit = (
  stage: "requested" | "completed" | "failed",
  code?: string,
) => void;
export class SandboxPayPal {
  #defaultTransport: boolean;
  #token: { value: string; expires: number } | null = null;
  #pending: Promise<string> | null = null;
  constructor(
    private config: SandboxConfig,
    private fetcher: typeof fetch = globalThis.fetch,
    private now: () => number = Date.now,
    private timeoutMs = 15000,
  ) {
    this.#defaultTransport = fetcher === globalThis.fetch;
    if (process.env.NODE_ENV === "test" && this.#defaultTransport)
      throw new PaymentError("NOT_CONFIGURED", 503);
  }
  private async request(
    path: string,
    init: RequestInit,
    financial: boolean,
  ): Promise<unknown> {
    if (process.env.NODE_ENV === "test" && this.#defaultTransport)
      throw new PaymentError("NOT_CONFIGURED", 503);
    if (
      !/^\/(v1\/oauth2\/token|v2\/checkout\/orders(?:\/[A-Z0-9]{10,32}(?:\/capture)?)?)$/.test(
        path,
      )
    )
      throw new PaymentError("SANDBOX_ONLY", 503);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(PAYPAL_SANDBOX_BASE + path, {
        ...init,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      if (!reader)
        throw new PaymentError(
          "INVALID_PROVIDER_RESPONSE",
          502,
          null,
          financial,
        );
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 256 * 1024) {
            await reader.cancel();
            throw new PaymentError(
              "INVALID_PROVIDER_RESPONSE",
              502,
              null,
              financial,
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new PaymentError(
          "INVALID_PROVIDER_RESPONSE",
          502,
          null,
          financial,
        );
      }
      if (!response.ok) {
        if (response.status === 401) this.#token = null;
        throw new PaymentError(
          response.status === 401 || response.status === 403
            ? "AUTHENTICATION_FAILED"
            : response.status >= 500 || response.status === 429
              ? "PROVIDER_UNAVAILABLE"
              : "PROVIDER_REJECTED",
          502,
          errorCode(body),
          financial &&
            (response.status >= 500 ||
              response.status === 429 ||
              response.status === 409 ||
              response.status === 408),
        );
      }
      return body;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError("TIMEOUT_OR_CONNECTION", 502, null, financial);
    } finally {
      clearTimeout(timer);
    }
  }
  private async token(audit: PayPalAudit): Promise<string> {
    if (this.#token && this.#token.expires > this.now())
      return this.#token.value;
    if (this.#pending) return this.#pending;
    this.#pending = (async () => {
      audit("requested");
      try {
        const raw = await this.request(
          "/v1/oauth2/token",
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: "grant_type=client_credentials",
          },
          false,
        );
        const p = z
          .object({
            access_token: z.string().min(8).max(16000),
            token_type: z.literal("Bearer"),
            expires_in: z.number().int().positive().max(86400),
          })
          .safeParse(raw);
        if (!p.success)
          throw new PaymentError("INVALID_PROVIDER_RESPONSE", 502);
        this.#token = {
          value: p.data.access_token,
          expires: this.now() + Math.max(0, p.data.expires_in - 60) * 1000,
        };
        audit("completed");
        return this.#token.value;
      } catch (error) {
        audit(
          "failed",
          error instanceof PaymentError ? error.code : "AUTHENTICATION_FAILED",
        );
        throw error;
      }
    })();
    try {
      return await this.#pending;
    } finally {
      this.#pending = null;
    }
  }
  async create(
    context: PaymentContext,
    requestId: string,
    audit: PayPalAudit,
    beforeExternal: () => void,
  ): Promise<ObservedOrder> {
    const token = await this.token(audit);
    beforeExternal();
    const total = {
      currency_code: context.currency,
      value: paypalDecimal(context.total_amount_minor, context.currency),
    };
    const raw = await this.request(
      "/v2/checkout/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: context.proposal_id,
              custom_id: context.proposal_id,
              description:
                "Rogue Agent Control sandbox simulation. No retailer fulfillment.",
              amount: { ...total, breakdown: { item_total: total } },
              payee: { merchant_id: context.seller_merchant_id },
              items: [
                {
                  name: "Sandbox demonstration item - no fulfillment",
                  sku: context.source_product_id,
                  quantity: String(context.quantity),
                  unit_amount: {
                    currency_code: context.currency,
                    value: paypalDecimal(
                      context.unit_amount_minor,
                      context.currency,
                    ),
                  },
                },
              ],
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Rogue Agent Control Sandbox",
                shipping_preference: "NO_SHIPPING",
                user_action: "CONTINUE",
                return_url: `${context.return_base_url}/checkout?proposal_id=${encodeURIComponent(context.proposal_id)}`,
                cancel_url: `${context.return_base_url}/checkout?proposal_id=${encodeURIComponent(context.proposal_id)}&cancel=1`,
              },
            },
          },
        }),
      },
      true,
    );
    return inspectOrder(raw, context);
  }
  async lookup(
    context: PaymentContext,
    orderId: string,
    audit: PayPalAudit,
    beforeExternal: () => void,
  ) {
    paypalId.parse(orderId);
    const token = await this.token(audit);
    beforeExternal();
    return inspectOrder(
      await this.request(
        `/v2/checkout/orders/${orderId}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        false,
      ),
      context,
      orderId,
    );
  }
  async capture(
    context: PaymentContext,
    orderId: string,
    requestId: string,
    audit: PayPalAudit,
    beforeExternal: () => void,
  ) {
    paypalId.parse(orderId);
    const token = await this.token(audit);
    beforeExternal();
    return inspectOrder(
      await this.request(
        `/v2/checkout/orders/${orderId}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": requestId,
            Prefer: "return=representation",
          },
          body: "{}",
        },
        true,
      ),
      context,
      orderId,
    );
  }
}
