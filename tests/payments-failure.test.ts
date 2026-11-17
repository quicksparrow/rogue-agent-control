import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { BlackBoxStore } from "../src/server/store";
import { sandboxConfig } from "../src/server/payments/config";
import { SandboxPayPal } from "../src/server/payments/paypal";
import { trustedPaymentContext } from "../src/server/payments/context";
import { sandboxGateway, paymentView } from "../src/server/payments/gateway";
import { readPayment } from "../src/server/payments/repository";
import { preparePayment, providerOrder, testEnv } from "./payment-helpers";
const old = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, testEnv);
  Reflect.set(process.env, "NODE_ENV", "test");
  delete process.env.PAYPAL_BASE_URL;
});
after(() => {
  for (const k of [...Object.keys(testEnv), "NODE_ENV", "PAYPAL_BASE_URL"]) {
    if (old[k] === undefined) Reflect.deleteProperty(process.env, k);
    else Reflect.set(process.env, k, old[k]);
  }
});
async function using(fn: (s: BlackBoxStore) => unknown) {
  const store = new BlackBoxStore(":memory:");
  try {
    await fn(store);
  } finally {
    if (store.db.open) store.close();
  }
}
test("OAuth failure stops before create, records safe provider codes and never logs provider messages", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    let calls = 0;
    const p = new SandboxPayPal(sandboxConfig(), async (input) => {
      calls++;
      assert.ok(String(input).endsWith("/token"));
      assert.ok(readPayment(store, proposal.proposal_id));
      return Response.json(
        {
          error: "invalid_client",
          error_description: testEnv.PAYPAL_CLIENT_SECRET,
        },
        { status: 401 },
      );
    });
    const result = await sandboxGateway(store, p).operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    assert.equal(result.state, "failed");
    assert.equal(result.error_code, "AUTHENTICATION_FAILED");
    assert.equal(calls, 1);
    const events = JSON.stringify(store.detail(proposal.run_id).events);
    assert.ok(!events.includes(testEnv.PAYPAL_CLIENT_SECRET));
    assert.ok(events.includes("AUTHENTICATION_FAILED"));
  }));
test("create 4xx is failed while 5xx and malformed responses remain unknown; no automatic retry", () =>
  using(async (store) => {
    for (const [status, response, expected] of [
      [422, { name: "UNPROCESSABLE_ENTITY" }, "failed"],
      [500, { name: "INTERNAL_SERVER_ERROR" }, "unknown_reconciling"],
      [201, { bad: "PRIVATE_PROVIDER_BODY" }, "unknown_reconciling"],
    ] as const) {
      const { proposal } = preparePayment(store);
      let posts = 0;
      const p = new SandboxPayPal(sandboxConfig(), async (input) => {
        if (String(input).endsWith("/token"))
          return Response.json({
            access_token: "TEST_TOKEN_CANARY",
            token_type: "Bearer",
            expires_in: 3600,
          });
        posts++;
        return Response.json(response, { status });
      });
      const result = await sandboxGateway(store, p).operate({
        proposal_id: proposal.proposal_id,
        operation: "create",
      });
      assert.equal(result.state, expected);
      assert.equal(result.payment_captured, false);
      assert.equal(posts, 1);
      assert.ok(
        !JSON.stringify(store.detail(proposal.run_id)).includes(
          "PRIVATE_PROVIDER_BODY",
        ),
      );
    }
  }));
test("partial create response preserves its safe order ID for read-only reconciliation", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    let posts = 0,
      gets = 0;
    const p = new SandboxPayPal(sandboxConfig(), async (input, init) => {
      if (String(input).endsWith("/token"))
        return Response.json({
          access_token: "TEST_TOKEN_CANARY",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (init?.method === "POST") {
        posts++;
        return Response.json(
          { id: "ORDER123456789", status: "CREATED" },
          { status: 201 },
        );
      }
      gets++;
      return Response.json(providerOrder(c));
    });
    const gateway = sandboxGateway(store, p);
    const result = await gateway.operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    assert.equal(result.state, "unknown_reconciling");
    assert.equal(result.order_id, "ORDER123456789");
    assert.equal(result.can_retry_create, false);
    const known = await gateway.operate({
      proposal_id: proposal.proposal_id,
      operation: "verify",
    });
    assert.equal(known.state, "buyer_approval_pending");
    assert.equal(posts, 1);
    assert.equal(gets, 1);
  }));
test("pending capture and COMPLETED order without a confirmed capture never claim captured", () =>
  using(async (store) => {
    for (const kind of ["pending", "missing"]) {
      const { proposal } = preparePayment(store),
        c = trustedPaymentContext(store, proposal.proposal_id);
      const p = new SandboxPayPal(sandboxConfig(), async (input, init) => {
        const path = String(input);
        if (path.endsWith("/token"))
          return Response.json({
            access_token: "TEST_TOKEN_CANARY",
            token_type: "Bearer",
            expires_in: 3600,
          });
        const o = providerOrder(
          c,
          init?.method === "GET"
            ? "APPROVED"
            : path.endsWith("/capture")
              ? "COMPLETED"
              : "CREATED",
          kind === "pending" && path.endsWith("/capture"),
        );
        if (kind === "pending" && o.purchase_units[0].payments)
          o.purchase_units[0].payments.captures[0].status = "PENDING";
        return Response.json(o);
      });
      const g = sandboxGateway(store, p);
      await g.operate({
        proposal_id: proposal.proposal_id,
        operation: "create",
      });
      await g.operate({
        proposal_id: proposal.proposal_id,
        operation: "verify",
      });
      const result = await g.operate({
        proposal_id: proposal.proposal_id,
        operation: "capture",
      });
      assert.equal(result.state, "unknown_reconciling");
      assert.equal(result.payment_captured, false);
      assert.equal(
        result.capture_status,
        kind === "pending" ? "PENDING" : null,
      );
      assert.ok(
        store
          .detail(proposal.run_id)
          .gaps.some((gap) => gap.code === "payment_outcome_unknown"),
      );
    }
  }));
test("sandbox seller or policy context changes prevent every subsequent PayPal operation", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    let calls = 0;
    const p = new SandboxPayPal(sandboxConfig(), async (input) => {
      calls++;
      return Response.json(
        String(input).endsWith("/token")
          ? {
              access_token: "TEST_TOKEN_CANARY",
              token_type: "Bearer",
              expires_in: 3600,
            }
          : providerOrder(c),
      );
    });
    const g = sandboxGateway(store, p);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    const count = calls;
    process.env.PAYPAL_SANDBOX_MERCHANT_ID = "JKLM2345ABCDE";
    for (const operation of ["verify", "capture", "create"]) {
      await assert.rejects(
        g.operate({ proposal_id: proposal.proposal_id, operation }),
      );
    }
    assert.equal(calls, count);
    assert.equal(paymentView(store, proposal.proposal_id).available, false);
  }));
test("concurrent capture clicks invoke one capture and preserve the original idempotency reference", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    let captures = 0,
      release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ids: string[] = [];
    const p = new SandboxPayPal(sandboxConfig(), async (input, init) => {
      const path = String(input);
      if (path.endsWith("/token"))
        return Response.json({
          access_token: "TEST_TOKEN_CANARY",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (path.endsWith("/capture")) {
        captures++;
        ids.push(new Headers(init?.headers).get("PayPal-Request-Id")!);
        await gate;
        return Response.json(providerOrder(c, "COMPLETED", true));
      }
      return Response.json(
        providerOrder(c, init?.method === "GET" ? "APPROVED" : "CREATED"),
      );
    });
    const g = sandboxGateway(store, p);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    await g.operate({ proposal_id: proposal.proposal_id, operation: "verify" });
    const expected = readPayment(
      store,
      proposal.proposal_id,
    )!.capture_request_id;
    const first = g.operate({
      proposal_id: proposal.proposal_id,
      operation: "capture",
    });
    await new Promise((r) => setTimeout(r, 5));
    await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "capture",
    });
    release();
    await first;
    assert.equal(captures, 1);
    assert.deepEqual(ids, [expected]);
  }));
test("capture rejection stays unresolved and never reissues capture on retry or repeated verification", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    let captures = 0;
    const p = new SandboxPayPal(sandboxConfig(), async (input, init) => {
      const path = String(input);
      if (path.endsWith("/token"))
        return Response.json({
          access_token: "TEST_TOKEN_CANARY",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (path.endsWith("/capture")) {
        captures++;
        return Response.json(
          {
            name: "UNPROCESSABLE_ENTITY",
            details: [{ issue: "INSTRUMENT_DECLINED" }],
          },
          { status: 422 },
        );
      }
      return Response.json(
        providerOrder(c, init?.method === "GET" ? "APPROVED" : "CREATED"),
      );
    });
    const g = sandboxGateway(store, p);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    await g.operate({ proposal_id: proposal.proposal_id, operation: "verify" });
    assert.equal(
      (
        await g.operate({
          proposal_id: proposal.proposal_id,
          operation: "capture",
        })
      ).state,
      "unknown_reconciling",
    );
    await assert.rejects(
      g.operate({ proposal_id: proposal.proposal_id, operation: "capture" }),
    );
    await g.operate({ proposal_id: proposal.proposal_id, operation: "verify" });
    assert.equal(captures, 1);
  }));
test("abandoned execution leases become persisted unknown states without retrying the provider", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const c = trustedPaymentContext(store, proposal.proposal_id);
    const p = new SandboxPayPal(sandboxConfig(), async (input) =>
      String(input).endsWith("/token")
        ? Response.json({
            access_token: "TEST_TOKEN_CANARY",
            token_type: "Bearer",
            expires_in: 3600,
          })
        : Response.json(providerOrder(c)),
    );
    await sandboxGateway(store, p).operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    const record = readPayment(store, proposal.proposal_id)!;
    record.state = "capture_pending";
    record.capture_attempts = 1;
    record.active_operation = "capture";
    record.operation_token = "abandoned_operation";
    record.updated_at = new Date(Date.now() - 130000).toISOString();
    store.db
      .prepare("UPDATE sandbox_payments SET record_json=? WHERE proposal_id=?")
      .run(JSON.stringify(record), proposal.proposal_id);
    const view = paymentView(store, proposal.proposal_id);
    assert.equal(view.state, "unknown_reconciling");
    assert.equal(view.can_capture, false);
    assert.equal(view.can_verify, true);
    assert.equal(
      readPayment(store, proposal.proposal_id)!.state,
      "unknown_reconciling",
    );
  }));
test("immutable mapping/context and closed storage fail before any external operation", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    let calls = 0;
    const p = new SandboxPayPal(sandboxConfig(), async (input) => {
      calls++;
      return Response.json(
        String(input).endsWith("/token")
          ? {
              access_token: "TEST_TOKEN_CANARY",
              token_type: "Bearer",
              expires_in: 3600,
            }
          : providerOrder(c),
      );
    });
    const g = sandboxGateway(store, p);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    assert.throws(() =>
      store.db.prepare("UPDATE sandbox_payments SET context_json='{}'").run(),
    );
    assert.throws(() =>
      store.db.prepare("DELETE FROM sandbox_seller_mappings").run(),
    );
    const count = calls;
    store.close();
    await assert.rejects(
      g.operate({ proposal_id: proposal.proposal_id, operation: "capture" }),
    );
    assert.equal(calls, count);
  }));
