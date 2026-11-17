import { identifier } from "../../../../lib/contracts";
import { paymentRequestSchema } from "../../../../lib/payment-contracts";
import { getStore } from "../../../../server/store";
import { apiError, json, localOnly, readJson } from "../../../../server/http";
import {
  paymentView,
  sandboxGateway,
} from "../../../../server/payments/gateway";
import { PaymentError } from "../../../../server/payments/config";
import { recordRejectedGatewayRequest } from "../../../../server/firewall/gateway";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    localOnly(request);
    const url = new URL(request.url);
    if (
      [...url.searchParams.keys()].some((k) => k !== "proposal_id") ||
      url.searchParams.getAll("proposal_id").length !== 1
    )
      throw new PaymentError("CONTEXT_INVALID", 400);
    return json({
      payment: paymentView(
        getStore(),
        identifier.parse(url.searchParams.get("proposal_id")),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    localOnly(request);
    const raw = await readJson(request),
      parsed = paymentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      recordRejectedGatewayRequest(getStore(), raw);
      throw parsed.error;
    }
    return json({
      payment: await sandboxGateway(getStore()).operate(parsed.data),
    });
  } catch (error) {
    if (error instanceof PaymentError)
      return json(
        { error: error.message, error_code: error.code },
        error.status,
      );
    return apiError(error);
  }
}
