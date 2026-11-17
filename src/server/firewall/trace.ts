import { randomUUID } from "node:crypto";
import type { BlackBoxStore } from "../store";
import type { StoredEvent } from "../../lib/contracts";

export function recordFirewallEvent(
  store: BlackBoxStore,
  runId: string,
  type: StoredEvent["event_type"],
  payload: Record<string, unknown>,
  source: "policy_firewall" | "trusted_gateway" = "policy_firewall",
) {
  store.appendFirewall(
    runId,
    [
      {
        schema_version: 3,
        event_id: `evt_${randomUUID()}`,
        parent_event_id: store.lastEventId(runId),
        timestamp: new Date().toISOString(),
        actor: "policy_gateway",
        event_type: type,
        tool: null,
        payload,
      },
    ],
    source,
  );
}
