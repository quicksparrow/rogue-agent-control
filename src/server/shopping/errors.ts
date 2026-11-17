export const errorMessages = {
  unavailable:
    "The integration could not be reached. Check the local service or network.",
  model_unavailable:
    "qwen3:4b is not available in Ollama. Install it with ollama pull qwen3:4b.",
  timeout:
    "The integration exceeded its configured time limit. No substitute response was generated.",
  invalid_model_output:
    "The model did not return a complete, valid structured decision.",
  invalid_tool_arguments:
    "The model proposed an unregistered tool or invalid arguments. Nothing was executed.",
  ungrounded_product:
    "The model selected a product that was not returned by this catalog search.",
  malformed_catalog:
    "The catalog response did not contain supported, valid product offers.",
  empty_catalog:
    "The selected catalog returned no usable products. No catalog mode change was made.",
  not_configured:
    "Channel3 is not configured. Add CHANNEL3_API_KEY to .env.local and restart the server.",
  authentication_failed:
    "Channel3 rejected the API key. Check the server-side configuration.",
  rate_limited:
    "Channel3 rate limit reached. Try again later; the catalog mode has not changed.",
  credits_required:
    "Channel3 rejected the request because account credits are unavailable.",
  service_error:
    "The integration returned a service error. No response was fabricated.",
  context_limit:
    "The compact request exceeds the configured model context budget. Shorten the objective or preferences.",
  configuration:
    "The server integration configuration is invalid. Check the documented limits.",
  execution_limit:
    "The execution limit was reached. No additional tool or model calls were made.",
  cancelled: "Execution was cancelled before completion.",
} as const;
export type ErrorCode = keyof typeof errorMessages;
export class IntegrationError extends Error {
  constructor(public code: ErrorCode) {
    super(errorMessages[code]);
  }
}
export function safeFailure(error: unknown) {
  return error instanceof IntegrationError
    ? error
    : new IntegrationError("service_error");
}
