import { identifier } from "../lib/contracts";
import type { LocalIdentity } from "../lib/shopping-contracts";
import { IntegrationError } from "./shopping/errors";

export function localIdentity(): LocalIdentity {
  const owner = identifier.safeParse(
    process.env.ROGUE_OWNER_ID || "local_buyer",
  );
  const agent = identifier.safeParse(
    process.env.ROGUE_AGENT_ID || "shopping_qwen3",
  );
  if (!owner.success || !agent.success)
    throw new IntegrationError("configuration");
  return {
    owner_id: owner.data,
    agent_id: agent.data,
    attribution: "application_configuration",
    authenticated: false,
    authorized_context: "recommendations_only",
  };
}
