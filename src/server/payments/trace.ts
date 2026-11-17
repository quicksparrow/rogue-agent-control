import { randomUUID } from "node:crypto";
import type { BlackBoxStore } from "../store";
import type { StoredEvent } from "../../lib/contracts";
export function recordPaymentEvent(
  store: BlackBoxStore,
  runId: string,
  type: StoredEvent["event_type"],
  payload: Record<string, unknown>,
  provider = false,
) {
  store.appendPayment(
    runId,
    [
      {
        schema_version: 4,
        event_id: `evt_${randomUUID()}`,
        parent_event_id: store.lastEventId(runId),
        timestamp: new Date().toISOString(),
        actor: provider ? "paypal" : "policy_gateway",
        event_type: type,
        tool: null,
        payload,
      },
    ],
    provider ? "paypal_sandbox" : "trusted_gateway",
  );
}
