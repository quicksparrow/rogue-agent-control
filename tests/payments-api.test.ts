import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "../src/app/api/gateway/paypal/route";
import { getStore } from "../src/server/store";
import { createFirewallScenario } from "../src/server/firewall/scenarios";
import { preparePayment, testEnv } from "./payment-helpers";
const old = { ...process.env },
  dir = mkdtempSync(join(tmpdir(), "sandbox-api-"));
Object.assign(process.env, testEnv, {
  DATABASE_PATH: join(dir, "test.sqlite"),
});
Reflect.set(process.env, "NODE_ENV", "test");
after(() => {
  getStore().close();
  delete (globalThis as typeof globalThis & { rogueStore?: unknown })
    .rogueStore;
  for (const key of [...Object.keys(testEnv), "DATABASE_PATH", "NODE_ENV"]) {
    if (old[key] === undefined) Reflect.deleteProperty(process.env, key);
    else Reflect.set(process.env, key, old[key]);
  }
  rmSync(dir, { recursive: true, force: true });
});
function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/gateway/paypal", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
test("sandbox API accepts only an original proposal reference and strict operation; spoofed authority is rejected", async () => {
  const { proposal } = preparePayment(getStore());
  for (const extra of [
    { outcome: "ALLOW" },
    { approved: true },
    { amount: "0.01" },
    { seller_id: "FORGED" },
    { policy_version: "different" },
    { token: "DO_NOT_STORE_CALLBACK" },
  ])
    assert.equal(
      (
        await POST(
          req({
            proposal_id: proposal.proposal_id,
            operation: "create",
            ...extra,
          }),
        )
      ).status,
      400,
    );
  const detail = getStore().detail(proposal.run_id);
  assert.ok(detail.events.some((e) => e.event_type === "gateway_error"));
  assert.ok(!JSON.stringify(detail).includes("DO_NOT_STORE_CALLBACK"));
});
test("DENY and REVIEW API actions make zero provider or OAuth calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("External network is forbidden in unit/API tests");
  };
  try {
    for (const scenario of [
      "over_budget",
      "quantity_mismatch",
      "unknown_merchant",
      "approval_required",
    ] as const) {
      const { proposal } = createFirewallScenario(getStore(), scenario);
      for (const operation of ["create", "verify", "capture"]) {
        assert.equal(
          (await POST(req({ proposal_id: proposal.proposal_id, operation })))
            .status,
          409,
        );
      }
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("status lookup never contacts PayPal and origin/identifier checks reject bypasses", async () => {
  const { proposal } = preparePayment(getStore());
  const response = await GET(
    new Request(
      `http://127.0.0.1:3000/api/gateway/paypal?proposal_id=${proposal.proposal_id}`,
    ),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.payment.state, "eligible");
  assert.equal(body.payment.order_id, null);
  for (const query of [
    "proposal_id=missing&approved=true",
    "proposal_id=one&proposal_id=two",
    "proposal_id=bad%20id",
  ]) {
    assert.equal(
      (
        await GET(
          new Request(`http://127.0.0.1:3000/api/gateway/paypal?${query}`),
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await POST(
        req(
          { proposal_id: proposal.proposal_id, operation: "create" },
          { Origin: "https://attacker.invalid" },
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (await POST(req({ proposal_id: "proposal_missing", operation: "create" })))
      .status,
    404,
  );
});
test("test process cannot accidentally construct the real payment provider even with sandbox config present", async () => {
  const { proposal } = preparePayment(getStore());
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error();
  };
  try {
    const r = await POST(
      req({ proposal_id: proposal.proposal_id, operation: "create" }),
    );
    assert.equal(r.status, 503);
    assert.equal(calls, 0);
    assert.equal(
      getStore()
        .db.prepare("SELECT COUNT(*) n FROM sandbox_payments")
        .get() instanceof Object,
      true,
    );
  } finally {
    globalThis.fetch = original;
  }
});
