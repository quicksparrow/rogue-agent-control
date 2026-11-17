import { identifier } from "../../lib/contracts";
import { shoppingInputSchema } from "../../lib/shopping-contracts";
import type { BlackBoxStore } from "../store";
import { StoreError } from "../store";
import { createShoppingRun } from "../shopping/runtime";
import { ensureOwnerPolicies, getOwnerPolicy } from "./policies";
import { localIdentity } from "../identity";

const requestSchema = shoppingInputSchema.extend({
  owner_policy_version: identifier.optional(),
});
export function createControlledShoppingRun(
  store: BlackBoxStore,
  raw: unknown,
) {
  const parsed = requestSchema.parse(raw);
  const { owner_policy_version: selected, ...input } = parsed;
  const { policies } = ensureOwnerPolicies(store);
  const policy = selected
    ? getOwnerPolicy(store, selected)
    : policies.find((p) => p.persona === input.persona);
  if (
    !policy ||
    policy.owner_id !== localIdentity().owner_id ||
    policy.persona !== input.persona ||
    policy.usage !== "shopping"
  )
    throw new StoreError(
      403,
      "Owner policy cannot be selected for this mandate",
    );
  return createShoppingRun(store, input, { policy });
}
