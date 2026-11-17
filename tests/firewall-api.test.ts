import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GET as policiesGet,
  POST as policiesPost,
} from "../src/app/api/policies/route";
import { POST as scenariosPost } from "../src/app/api/firewall/scenarios/route";
import { POST as gatewayPost } from "../src/app/api/gateway/authorize/route";
import { POST as shoppingPost } from "../src/app/api/shopping/route";
import { POST as externalRunPost } from "../src/app/api/runs/route";
import { getStore } from "../src/server/store";

const dir = mkdtempSync(join(tmpdir(), "firewall-api-"));
const oldPath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(dir, "api.sqlite");
after(() => {
  getStore().close();
  delete (globalThis as typeof globalThis & { rogueStore?: unknown })
    .rogueStore;
  if (oldPath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = oldPath;
  rmSync(dir, { recursive: true, force: true });
});
const request = (
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) =>
  new Request(
    `http://127.0.0.1:3000${path}`,
    body === undefined
      ? { headers: extra }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", ...extra },
          body: JSON.stringify(body),
        },
  );

test("owner policy API creates immutable versions and server-owned identity; agent authority fields are rejected", async () => {
  const listed = await policiesGet(request("/api/policies"));
  assert.equal(listed.status, 200);
  const value = await listed.json();
  assert.equal(value.payment_adapter_installed, false);
  const policy = value.policies.find(
    (p: { persona: string }) => p.persona === "consumer",
  );
  const input = {
    parent_version: policy.version,
    label: "Consumer API revision",
    persona: "consumer",
    currency: "USD",
    max_transaction_minor: 15000,
    min_quantity: 1,
    max_quantity: 1,
    quantity_mismatch: "DENY",
    automatic_approval_minor: 14000,
    require_human_approval: false,
    approved_merchant_ids: ["demo_sports"],
    prohibited_merchant_ids: [],
  };
  const saved = await policiesPost(request("/api/policies", input));
  assert.equal(saved.status, 201);
  const next = await saved.json();
  assert.notEqual(next.policy.version, policy.version);
  assert.equal(next.policy.policy_id, policy.policy_id);
  assert.equal(next.policy.revision, policy.revision + 1);
  for (const extra of [
    { owner_id: "attacker" },
    { enabled: false },
    { approved: true },
    { policy_version: "forged" },
  ])
    assert.equal(
      (await policiesPost(request("/api/policies", { ...input, ...extra })))
        .status,
      400,
    );
});

test("API scenario and authorization responses come from stored evaluation, never client ALLOW or approval claims", async () => {
  const response = await scenariosPost(
    request("/api/firewall/scenarios", { scenario: "over_budget" }),
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.decision.outcome, "DENY");
  assert.equal(result.payment_executed, false);
  for (const extra of [
    { outcome: "ALLOW" },
    { approved: true },
    { budget_minor: 9999999 },
    { policy_version: "forged" },
    { disable_firewall: true },
  ]) {
    const attempt = await gatewayPost(
      request("/api/gateway/authorize", {
        proposal_id: result.proposal.proposal_id,
        ...extra,
      }),
    );
    assert.equal(attempt.status, 400);
  }
  const valid = await gatewayPost(
    request("/api/gateway/authorize", {
      proposal_id: result.proposal.proposal_id,
    }),
  );
  assert.equal(valid.status, 200);
  const repeated = await valid.json();
  assert.equal(repeated.decision.decision_id, result.decision.decision_id);
  assert.equal(repeated.state, "blocked");
  const trace = getStore().detail(result.run.run_id);
  assert.equal(
    trace.events.filter((e) => e.event_type === "policy_decision_recorded")
      .length,
    1,
  );
  assert.ok(
    trace.events.some(
      (e) =>
        e.event_type === "gateway_error" &&
        e.payload.code === "INVALID_GATEWAY_REQUEST",
    ),
  );
  assert.equal(
    (
      await gatewayPost(
        request("/api/gateway/authorize", { proposal_id: "proposal_unknown" }),
      )
    ).status,
    404,
  );
});

test("new shopping mandates bind an owner version; the API cannot replace an existing run's policy or identities", async () => {
  const body = {
    persona: "business",
    catalog_mode: "offline",
    objective: "Find 10 wireless mice under $250.",
    budget_minor: 25000,
    currency: "USD",
    quantity: 10,
    preferences: ["Wireless"],
    merchant_ids: ["seed_office"],
  };
  const response = await shoppingPost(request("/api/shopping", body));
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.ok(result.execution.policy.firewall.owner_policy_version);
  assert.equal(result.execution.mandate.identity.owner_id, "local_buyer");
  assert.equal(
    result.execution.mandate.identity.authorized_context,
    "policy_controlled_proposals",
  );
  for (const extra of [
    { owner_id: "attacker" },
    { agent_id: "attacker" },
    { policy: { max_total_minor: 999999 } },
    { owner_policy_version: "unregistered_version" },
  ])
    assert.notEqual(
      (await shoppingPost(request("/api/shopping", { ...body, ...extra })))
        .status,
      201,
    );
});

test("cross-origin mutations, disabled fixture requests and malformed requests are rejected without remote calls", async () => {
  assert.equal(
    (
      await scenariosPost(
        request(
          "/api/firewall/scenarios",
          { scenario: "allowed" },
          { Origin: "https://foreign.invalid" },
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await scenariosPost(
        request("/api/firewall/scenarios", {
          scenario: "allowed",
          firewall_disabled: true,
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await gatewayPost(
        request("/api/gateway/authorize", {
          action: { amount: 1 },
          outcome: "ALLOW",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await externalRunPost(
        request("/api/runs", {
          persona: "consumer",
          policy: {
            version: "spoofed",
            owner_id: "attacker",
            max_total_minor: 999999,
            currency: "USD",
            merchant_ids: ["seed_sports"],
            max_quantity: 1,
            approval_required: false,
            firewall: {
              owner_policy_version: "forged",
              registry_version: "forged",
            },
          },
        }),
      )
    ).status,
    400,
  );
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected remote request");
  };
  try {
    const response = await scenariosPost(
      request("/api/firewall/scenarios", { scenario: "allowed" }),
    );
    assert.equal(response.status, 201);
    assert.equal((await response.json()).payment_executed, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
