import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { BlackBoxStore } from "../src/server/store";
import {
  sandboxConfig,
  PaymentError,
  PAYPAL_SANDBOX_BASE,
} from "../src/server/payments/config";
import { SandboxPayPal, inspectOrder } from "../src/server/payments/paypal";
import {
  sandboxGateway,
  paymentView,
  CREATE_RETRY_WINDOW_MS,
} from "../src/server/payments/gateway";
import { trustedPaymentContext } from "../src/server/payments/context";
import { readPayment, savePayment } from "../src/server/payments/repository";
import { paypalDecimal } from "../src/lib/payment-contracts";
import {
  parseEvent,
  parseRuntimeEvent,
  parseFirewallEvent,
  parsePaymentEvent,
} from "../src/lib/contracts";
import { safeText } from "../src/server/shopping/sanitize";
import { createFirewallScenario } from "../src/server/firewall/scenarios";
import {
  ensureOwnerPolicies,
  createOwnerPolicy,
} from "../src/server/firewall/policies";
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
  const s = new BlackBoxStore(":memory:");
  try {
    await fn(s);
  } finally {
    if (s.db.open) s.close();
  }
}
function adapter(
  store: BlackBoxStore,
  proposalId: string,
  override?: (path: string, init: RequestInit) => Promise<Response> | Response,
) {
  const calls: { path: string; body: string; requestId: string | null }[] = [];
  const context = trustedPaymentContext(store, proposalId);
  let status = "CREATED",
    captured = false;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    assert.ok(String(input).startsWith(PAYPAL_SANDBOX_BASE + "/"));
    assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    calls.push({
      path,
      body: String(init.body ?? ""),
      requestId: headers.get("PayPal-Request-Id"),
    });
    if (override) {
      const r = await override(path, init);
      if (r) return r;
    }
    if (path.endsWith("/token"))
      return Response.json({
        access_token: "MOCK_OAUTH_TOKEN_DO_NOT_STORE",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (path.endsWith("/capture")) {
      captured = true;
      status = "COMPLETED";
    }
    return Response.json(providerOrder(context, status, captured), {
      status: init.method === "POST" ? 201 : 200,
    });
  };
  return {
    provider: new SandboxPayPal(sandboxConfig(), fetcher),
    calls,
    approve: () => {
      status = "APPROVED";
    },
    context,
  };
}
test("sandbox-only config requires explicit mode, credentials and canonical demo mapping; never guesses names", () => {
  assert.ok(sandboxConfig());
  for (const value of ["live", "production", ""]) {
    process.env.PAYPAL_MODE = value;
    assert.throws(sandboxConfig);
  }
  process.env.PAYPAL_MODE = "sandbox";
  process.env.PAYPAL_BASE_URL = "https://api-m.paypal.com";
  assert.throws(sandboxConfig);
  delete process.env.PAYPAL_BASE_URL;
  for (const ids of ["seed_sports,seed_office", "amazon.com", ""]) {
    process.env.PAYPAL_SANDBOX_DEMO_MERCHANT_IDS = ids;
    assert.throws(sandboxConfig);
  }
  process.env.PAYPAL_SANDBOX_DEMO_MERCHANT_IDS = "demo_sports";
  delete process.env.PAYPAL_SANDBOX_MERCHANT_ID;
  assert.throws(sandboxConfig);
  process.env.PAYPAL_SANDBOX_MERCHANT_ID = testEnv.PAYPAL_SANDBOX_MERCHANT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  assert.throws(sandboxConfig);
});
test("decimal formatting is exact integer arithmetic with explicit supported precision", () => {
  assert.equal(paypalDecimal(14900, "USD"), "149.00");
  assert.equal(paypalDecimal(1, "EUR"), "0.01");
  for (const n of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => paypalDecimal(n, "USD"));
  assert.throws(() => paypalDecimal(100, "JPY"));
});
test("create persists exclusive claim before OAuth and uses only trusted request body, sandbox payee and stable request ID", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id);
    const gateway = sandboxGateway(store, a.provider);
    const result = await gateway.operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    assert.equal(result.state, "buyer_approval_pending");
    assert.equal(result.payment_captured, false);
    assert.equal(result.order_id, "ORDER123456789");
    assert.equal(result.provider_status, "CREATED");
    const saved = readPayment(store, proposal.proposal_id)!;
    assert.equal(saved.create_attempts, 1);
    const post = a.calls.find((c) => c.path.endsWith("/orders"))!;
    assert.equal(post.requestId, saved.create_request_id);
    const body = JSON.parse(post.body);
    assert.equal(body.purchase_units[0].amount.value, "89.95");
    assert.equal(
      body.purchase_units[0].payee.merchant_id,
      testEnv.PAYPAL_SANDBOX_MERCHANT_ID,
    );
    assert.equal(
      body.payment_source.paypal.experience_context.shipping_preference,
      "NO_SHIPPING",
    );
    assert.ok(
      body.payment_source.paypal.experience_context.return_url.startsWith(
        testEnv.PAYPAL_RETURN_BASE_URL + "/checkout?proposal_id=",
      ),
    );
    assert.equal(body.processing_instruction, undefined);
    await gateway.operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    assert.equal(a.calls.filter((c) => c.path.endsWith("/orders")).length, 1);
  }));
test("DENY, REVIEW, synthetic fixtures and unknown merchants produce zero PayPal calls", () =>
  using(async (store) => {
    let calls = 0;
    const mock = {
      create: async () => {
        calls++;
        throw new Error();
      },
      lookup: async () => {
        calls++;
        throw new Error();
      },
      capture: async () => {
        calls++;
        throw new Error();
      },
    };
    const gateway = sandboxGateway(store, mock);
    for (const scenario of [
      "allowed",
      "over_budget",
      "quantity_mismatch",
      "unknown_merchant",
      "approval_required",
    ] as const) {
      const { proposal } = createFirewallScenario(store, scenario);
      await assert.rejects(
        gateway.operate({
          proposal_id: proposal.proposal_id,
          operation: "create",
        }),
      );
    }
    const denied = preparePayment(store, { budget: 8000 });
    await assert.rejects(
      gateway.operate({
        proposal_id: denied.proposal.proposal_id,
        operation: "create",
      }),
    );
    const base = ensureOwnerPolicies(store).policies.find(
      (p) => p.persona === "consumer",
    )!;
    const {
      policy_id,
      version,
      revision,
      owner_id,
      registry_version,
      created_at,
      usage,
      ...config
    } = base;
    const review = createOwnerPolicy(store, {
      ...config,
      require_human_approval: true,
    });
    const r = preparePayment(store, { ownerPolicy: review.version });
    await assert.rejects(
      gateway.operate({
        proposal_id: r.proposal.proposal_id,
        operation: "create",
      }),
    );
    assert.equal(calls, 0);
  }));
test("client approval, amount, seller, budget and policy overrides are rejected without OAuth or financial calls", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id),
      g = sandboxGateway(store, a.provider);
    for (const extra of [
      { outcome: "ALLOW" },
      { approved: true },
      { amount: 1 },
      { seller_merchant_id: testEnv.PAYPAL_SANDBOX_MERCHANT_ID },
      { budget_minor: 999999 },
      { policy_version: "forged" },
    ])
      await assert.rejects(
        g.operate({
          proposal_id: proposal.proposal_id,
          operation: "create",
          ...extra,
        }),
      );
    assert.equal(a.calls.length, 0);
  }));
test("policy or owner becoming invalid during OAuth prevents the subsequent order POST", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id, async (path) => {
      if (path.endsWith("/token")) {
        process.env.ROGUE_OWNER_ID = "other_owner";
        return Response.json({
          access_token: "MOCK_TOKEN_12345",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      throw new Error("must not reach financial operation");
    });
    const result = await sandboxGateway(store, a.provider).operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    assert.equal(result.available, false);
    assert.equal(a.calls.filter((c) => c.path.endsWith("/orders")).length, 0);
  }));
test("unknown source/stock/price and unconfigured sandbox seller cannot use seeded checkout", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store, {
      productIds: ["seed_shoes_clearance"],
    });
    assert.throws(() => trustedPaymentContext(store, proposal.proposal_id));
    const good = preparePayment(store);
    process.env.PAYPAL_SANDBOX_DEMO_MERCHANT_IDS = "demo_office";
    assert.throws(() =>
      trustedPaymentContext(store, good.proposal.proposal_id),
    );
  }));
test("concurrent create clicks reserve one proposal and alternatives cannot reuse the mandate", () =>
  using(async (store) => {
    const { proposals } = preparePayment(store, {
      productIds: ["seed_shoes_daily", "seed_shoes_light"],
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const a = adapter(store, proposals[0].proposal_id, async (path) => {
      if (path.endsWith("/orders")) await gate;
      return undefined as unknown as Response;
    });
    const g = sandboxGateway(store, a.provider);
    const first = g.operate({
      proposal_id: proposals[0].proposal_id,
      operation: "create",
    });
    await new Promise((r) => setTimeout(r, 5));
    const other = await g.operate({
      proposal_id: proposals[0].proposal_id,
      operation: "create",
    });
    assert.equal(other.state, "order_creating");
    await assert.rejects(
      g.operate({ proposal_id: proposals[1].proposal_id, operation: "create" }),
    );
    release();
    await first;
    assert.equal(a.calls.filter((c) => c.path.endsWith("/orders")).length, 1);
  }));
test("create timeout remains unknown; explicit authorized retry reuses ID and payload within retention", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    let failed = false;
    const a = adapter(store, proposal.proposal_id, async (path) => {
      if (path.endsWith("/orders") && !failed) {
        failed = true;
        throw new Error("RAW_SECRET_MUST_NOT_LEAK");
      }
      return undefined as unknown as Response;
    });
    const g = sandboxGateway(store, a.provider);
    const first = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    assert.equal(first.state, "unknown_reconciling");
    assert.equal(first.can_retry_create, true);
    const retry = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "retry_create",
    });
    assert.equal(retry.state, "buyer_approval_pending");
    const calls = a.calls.filter((c) => c.path.endsWith("/orders"));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, calls[1].requestId);
    assert.equal(calls[0].body, calls[1].body);
  }));
test("create retry is refused after retention and missing order IDs cannot be looked up", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id, async (path) => {
      if (path.endsWith("/orders")) throw new Error();
      return undefined as unknown as Response;
    });
    const g = sandboxGateway(store, a.provider);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    const p = readPayment(store, proposal.proposal_id)!;
    p.create_started_at = new Date(
      Date.now() - CREATE_RETRY_WINDOW_MS - 1000,
    ).toISOString();
    savePayment(store, p);
    await assert.rejects(
      g.operate({
        proposal_id: proposal.proposal_id,
        operation: "retry_create",
      }),
    );
    await assert.rejects(
      g.operate({ proposal_id: proposal.proposal_id, operation: "verify" }),
    );
    assert.equal(a.calls.filter((c) => c.path.endsWith("/orders")).length, 1);
  }));
test("buyer approval is established by lookup; capture requires a separate action and rechecks provider approval", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id),
      g = sandboxGateway(store, a.provider);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    await assert.rejects(
      g.operate({ proposal_id: proposal.proposal_id, operation: "capture" }),
    );
    a.approve();
    const verified = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "verify",
    });
    assert.equal(verified.state, "buyer_approved");
    assert.ok(verified.approval_verified_at);
    assert.equal(a.calls.filter((c) => c.path.endsWith("/capture")).length, 0);
    const captured = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "capture",
    });
    assert.equal(captured.state, "captured");
    assert.equal(captured.capture_status, "COMPLETED");
    assert.equal(captured.capture_id, "CAPTURE1234567");
    assert.equal(captured.payment_captured, true);
    await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "capture",
    });
    assert.equal(a.calls.filter((c) => c.path.endsWith("/capture")).length, 1);
  }));
test("ambiguous capture is never resubmitted; known order reconciles by GET to confirmed capture", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    let captureLost = false,
      lookupUnavailable = false;
    const context = trustedPaymentContext(store, proposal.proposal_id);
    const a = adapter(store, proposal.proposal_id, async (path, init) => {
      if (lookupUnavailable && init.method === "GET")
        throw new Error("Read-only refresh unavailable");
      if (path.endsWith("/capture")) {
        captureLost = true;
        throw new Error();
      }
      if (captureLost && init.method === "GET")
        return Response.json(providerOrder(context, "COMPLETED", true));
      return undefined as unknown as Response;
    });
    const g = sandboxGateway(store, a.provider);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    a.approve();
    await g.operate({ proposal_id: proposal.proposal_id, operation: "verify" });
    const lost = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "capture",
    });
    assert.equal(lost.state, "unknown_reconciling");
    assert.equal(lost.can_capture, false);
    await assert.rejects(
      g.operate({ proposal_id: proposal.proposal_id, operation: "capture" }),
    );
    const found = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "verify",
    });
    assert.equal(found.state, "captured");
    lookupUnavailable = true;
    const unavailable = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "verify",
    });
    assert.equal(unavailable.state, "captured");
    assert.equal(unavailable.capture_status, "COMPLETED");
    assert.equal(unavailable.error_code, "TIMEOUT_OR_CONNECTION");
    assert.equal(a.calls.filter((c) => c.path.endsWith("/capture")).length, 1);
  }));
test("cancel is local, preserves observed provider status and prohibits capture even after later approval", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id),
      g = sandboxGateway(store, a.provider);
    await g.operate({ proposal_id: proposal.proposal_id, operation: "create" });
    const cancelled = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "cancel",
    });
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.provider_status, "CREATED");
    a.approve();
    const later = await g.operate({
      proposal_id: proposal.proposal_id,
      operation: "verify",
    });
    assert.equal(later.state, "cancelled");
    await assert.rejects(
      g.operate({ proposal_id: proposal.proposal_id, operation: "capture" }),
    );
    assert.equal(a.calls.filter((c) => c.path.endsWith("/capture")).length, 0);
  }));
test("provider responses cannot substitute seller, amount, currency, quantity, ID or approval host", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    for (const mutate of [
      (o: any) => (o.purchase_units[0].amount.value = "0.01"),
      (o: any) => (o.purchase_units[0].amount.currency_code = "EUR"),
      (o: any) => (o.purchase_units[0].payee.merchant_id = "JKLM2345ABCDE"),
      (o: any) => (o.purchase_units[0].items[0].quantity = "100"),
      (o: any) =>
        (o.links[0].href =
          "https://www.paypal.com/checkoutnow?token=ORDER123456789"),
      (o: any) => (o.id = "OTHER123456789"),
    ]) {
      const o = providerOrder(c);
      mutate(o);
      assert.throws(() => inspectOrder(o, c, "ORDER123456789"));
    }
  }));
test("OAuth token caching, expiration and failed tokens never persist or expose token data", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store),
      c = trustedPaymentContext(store, proposal.proposal_id);
    let now = 1000,
      oauth = 0;
    const p = new SandboxPayPal(
      sandboxConfig(),
      async (input) => {
        if (String(input).endsWith("/token")) {
          oauth++;
          return Response.json({
            access_token: "TOKEN_EXPIRY_CANARY",
            token_type: "Bearer",
            expires_in: 120,
          });
        }
        return Response.json(providerOrder(c));
      },
      () => now,
    );
    const audit = () => {};
    await p.lookup(c, "ORDER123456789", audit, () => {});
    await p.lookup(c, "ORDER123456789", audit, () => {});
    assert.equal(oauth, 1);
    now += 61000;
    await p.lookup(c, "ORDER123456789", audit, () => {});
    assert.equal(oauth, 2);
  }));
test("Black Box v4 correlates observed state and omits credentials, OAuth contents and buyer PII", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    const a = adapter(store, proposal.proposal_id);
    await sandboxGateway(store, a.provider).operate({
      proposal_id: proposal.proposal_id,
      operation: "create",
    });
    const detail = store.detail(proposal.run_id),
      events = detail.events.filter((e) => e.schema_version === 4);
    assert.ok(events.length >= 8);
    for (const e of events) {
      assert.equal(e.run_id, proposal.run_id);
      assert.equal(e.trace_id, detail.run.trace_id);
      assert.equal(e.policy_version, proposal.policy_version);
      assert.ok(e.parent_event_id);
      assert.equal(e.provenance.mode, "integration");
    }
    assert.ok(events.some((e) => e.provenance.source === "paypal_sandbox"));
    const all =
      JSON.stringify(store.db.prepare("SELECT * FROM events").all()) +
      JSON.stringify(store.db.prepare("SELECT * FROM sandbox_payments").all());
    for (const canary of [
      testEnv.PAYPAL_CLIENT_ID,
      testEnv.PAYPAL_CLIENT_SECRET,
      "MOCK_OAUTH_TOKEN_DO_NOT_STORE",
      "BUYER_PII_CANARY",
      "DO_NOT_PERSIST_BUYER",
    ]) {
      assert.ok(!all.includes(canary));
    }
    assert.equal(safeText(testEnv.PAYPAL_CLIENT_SECRET), "[REDACTED]");
    const first = events[0];
    for (const parser of [parseEvent, parseRuntimeEvent, parseFirewallEvent])
      assert.throws(() => parser(first));
    const {
      run_id,
      trace_id,
      policy_version,
      sequence,
      recorded_at,
      provenance,
      redacted_field_count,
      ...input
    } = first;
    const projected = parsePaymentEvent({
      ...input,
      payload: { ...input.payload, client_secret: "OMIT_PAYMENT_SECRET" },
    });
    assert.equal(projected.redacted_field_count, 1);
    assert.ok(!JSON.stringify(projected).includes("OMIT_PAYMENT_SECRET"));
  }));
test("application tests cannot accidentally obtain the real provider and test injection is refused outside isolation", () =>
  using(async (store) => {
    const { proposal } = preparePayment(store);
    assert.throws(() => new SandboxPayPal(sandboxConfig()));
    await assert.rejects(
      sandboxGateway(store).operate({
        proposal_id: proposal.proposal_id,
        operation: "create",
      }),
    );
    Reflect.set(process.env, "NODE_ENV", "production");
    assert.throws(() =>
      sandboxGateway(store, {
        create: async () => {
          throw new Error();
        },
        lookup: async () => {
          throw new Error();
        },
        capture: async () => {
          throw new Error();
        },
      }),
    );
  }));
