import { randomUUID } from "node:crypto";
import {
  merchantRegistrySchema,
  ownerPolicySchema,
  policyConfigurationSchema,
  type MerchantRegistry,
  type OwnerPolicy,
} from "../../lib/firewall-contracts";
import type { BlackBoxStore } from "../store";
import { StoreError } from "../store";
import { localIdentity } from "../identity";
import { safeText } from "../shopping/sanitize";

const registry: MerchantRegistry = {
  version: "merchant_registry_v1",
  mappings: [
    {
      catalog_source: "offline",
      provider_merchant_id: "seed_sports",
      merchant_id: "demo_sports",
      label: "Seeded sports seller",
      verified: true,
      scope: "demo_only",
    },
    {
      catalog_source: "offline",
      provider_merchant_id: "seed_office",
      merchant_id: "demo_office",
      label: "Seeded office seller",
      verified: true,
      scope: "demo_only",
    },
    {
      catalog_source: "offline",
      provider_merchant_id: "seed_outdoors",
      merchant_id: "demo_outdoors",
      label: "Seeded outdoor seller",
      verified: true,
      scope: "demo_only",
    },
    {
      catalog_source: "offline",
      provider_merchant_id: "seed_tech",
      merchant_id: "demo_tech",
      label: "Seeded technology seller",
      verified: true,
      scope: "demo_only",
    },
  ],
};

export function getRegistry(
  store: BlackBoxStore,
  version = registry.version,
): MerchantRegistry {
  const row = store.db
    .prepare("SELECT registry_json FROM merchant_registries WHERE version=?")
    .get(version) as { registry_json: string } | undefined;
  if (!row) throw new StoreError(503, "Trusted merchant registry unavailable");
  return merchantRegistrySchema.parse(JSON.parse(row.registry_json));
}
export function getOwnerPolicy(
  store: BlackBoxStore,
  version: string,
): OwnerPolicy {
  const row = store.db
    .prepare("SELECT policy_json FROM owner_policy_versions WHERE version=?")
    .get(version) as { policy_json: string } | undefined;
  if (!row) throw new StoreError(404, "Owner policy version not found");
  return ownerPolicySchema.parse(JSON.parse(row.policy_json));
}
export function listOwnerPolicies(
  store: BlackBoxStore,
  ownerId = localIdentity().owner_id,
): OwnerPolicy[] {
  return (
    store.db
      .prepare(
        "SELECT policy_json FROM owner_policy_versions WHERE owner_id=? ORDER BY rowid DESC",
      )
      .all(ownerId) as { policy_json: string }[]
  )
    .map((row) => ownerPolicySchema.parse(JSON.parse(row.policy_json)))
    .filter((p) => p.usage === "shopping");
}
export function createOwnerPolicy(
  store: BlackBoxStore,
  raw: unknown,
  usage: "shopping" | "fixture" = "shopping",
): OwnerPolicy {
  const owner = localIdentity().owner_id;
  const input = policyConfigurationSchema.parse(raw);
  const safe = policyConfigurationSchema.parse({
    ...input,
    label: safeText(input.label, 80),
  });
  const mappings = getRegistry(store);
  const known = new Set(mappings.mappings.map((m) => m.merchant_id));
  if (
    [...safe.approved_merchant_ids, ...safe.prohibited_merchant_ids].some(
      (id) => !known.has(id),
    )
  )
    throw new StoreError(
      400,
      "Merchant permissions must reference server-registered IDs; this interface cannot verify new merchants",
    );
  return store.db
    .transaction(() => {
      const parent = safe.parent_version
        ? getOwnerPolicy(store, safe.parent_version)
        : null;
      if (
        parent &&
        (parent.owner_id !== owner || parent.persona !== safe.persona)
      )
        throw new StoreError(403, "Policy ownership or persona does not match");
      const policyId = parent?.policy_id ?? `policy_${randomUUID()}`;
      const latest = store.db
        .prepare(
          "SELECT COALESCE(MAX(revision),0) n FROM owner_policy_versions WHERE policy_id=?",
        )
        .get(policyId) as { n: number };
      const value: OwnerPolicy = ownerPolicySchema.parse({
        ...safe,
        policy_id: policyId,
        version: `pver_${randomUUID()}`,
        revision: latest.n + 1,
        owner_id: owner,
        registry_version: mappings.version,
        created_at: new Date().toISOString(),
        usage,
      });
      store.db
        .prepare("INSERT INTO owner_policy_versions VALUES (?,?,?,?,?)")
        .run(
          value.version,
          value.policy_id,
          value.revision,
          owner,
          JSON.stringify(value),
        );
      return value;
    })
    .immediate();
}
export function ensureOwnerPolicies(store: BlackBoxStore) {
  return store.db
    .transaction(() => {
      store.db
        .prepare("INSERT OR IGNORE INTO merchant_registries VALUES (?,?)")
        .run(registry.version, JSON.stringify(registry));
      for (const persona of ["consumer", "business"] as const) {
        if (!listOwnerPolicies(store).some((p) => p.persona === persona))
          createOwnerPolicy(store, {
            label:
              persona === "consumer"
                ? "Consumer automatic research authorization"
                : "Business review required",
            persona,
            currency: "USD",
            max_transaction_minor: persona === "consumer" ? 15000 : 100000,
            min_quantity: 1,
            max_quantity: persona === "consumer" ? 1 : 1000,
            quantity_mismatch: persona === "consumer" ? "DENY" : "REVIEW",
            automatic_approval_minor: persona === "consumer" ? 15000 : 25000,
            require_human_approval: persona === "business",
            approved_merchant_ids: [
              persona === "consumer" ? "demo_sports" : "demo_office",
            ],
            prohibited_merchant_ids: [],
          });
      }
      return {
        policies: listOwnerPolicies(store),
        registry: getRegistry(store),
      };
    })
    .immediate();
}
