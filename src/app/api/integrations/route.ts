import { apiError, json, localOnly } from "../../../server/http";
import { OllamaModel } from "../../../server/shopping/ollama";
import { localIdentity } from "../../../server/shopping/runtime";
import { safeFailure } from "../../../server/shopping/errors";
import { sandboxAvailability } from "../../../server/payments/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    localOnly(request);
    let ollama: unknown;
    try {
      ollama = await new OllamaModel().health();
    } catch (error) {
      const failure = safeFailure(error);
      ollama = {
        available: false,
        error_code: failure.code,
        error: failure.message,
      };
    }
    return json({
      ollama,
      channel3: {
        configured: Boolean(process.env.CHANNEL3_API_KEY),
        connectivity: "checked_on_search",
      },
      identity: localIdentity(),
      paypal_sandbox: {
        ...sandboxAvailability(),
        mode: "sandbox",
        connectivity: "checked_on_explicit_operation",
        retailer_fulfillment: false,
      },
      boundaries: {
        checkout: false,
        paypal: false,
        firewall: true,
        replay: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
