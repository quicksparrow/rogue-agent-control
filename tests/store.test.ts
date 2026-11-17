import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BlackBoxStore, StoreError } from "../src/server/store";
import { parseEvent } from "../src/lib/contracts";
import { discrepancies, visibilityGaps } from "../src/lib/evidence";
import { scenarioEvents } from "../src/server/fixtures";

const input = (id = "evt_test", overrides: Record<string, unknown> = {}) => ({
  schema_version: 1,
  event_id: id,
  parent_event_id: null,
  timestamp: "2026-11-09T12:00:00-05:00",
  actor: "shopping_agent",
  event_type: "purchase_proposed",
  tool: null,
  payload: {
    product_id: "shoe_1",
    merchant_id: "approved_sports",
    unit_amount_minor: 14900,
    total_amount_minor: 14900,
    currency: "USD",
    quantity: 1,
  },
  ...overrides,
});

function usingStore(fn: (store: BlackBoxStore) => void) {
  const store = new BlackBoxStore(":memory:");
  try {
    fn(store);
  } finally {
    store.close();
  }
}

test("validates the versioned envelope, currency, integer money and bounded quantities", () => {
  assert.equal(parseEvent(input()).timestamp, "2026-11-09T17:00:00.000Z");
  for (const change of [
    { schema_version: 2 },
    { actor: "admin" },
    { timestamp: "yesterday" },
    { provenance: { trusted: true } },
    { trace_id: "spoofed" },
    { payload: { ...input().payload, currency: "ZZZ" } },
    { payload: { ...input().payload, total_amount_minor: 149.1 } },
    { payload: { ...input().payload, quantity: 0 } },
  ])
    assert.throws(() => parseEvent(input("e", change)));
});

test("drops credentials, PII, nested headers and private prompts before SQLite writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "rogue-redaction-"));
  const path = join(dir, "events.sqlite");
  const store = new BlackBoxStore(path);
  try {
    const run = store.createRun("consumer");
    store.append(run.run_id, [
      input("redacted", {
        payload: {
          ...input().payload,
          client_secret: "SECRET_CANARY_918273",
          buyer_email: "buyer@example.invalid",
          private_prompt: "PRIVATE_THOUGHT_CANARY",
          headers: { Authorization: "Bearer SECRET_CANARY_918273" },
        },
      }),
    ]);
    const event = store.detail(run.run_id).events[0];
    assert.equal(event.redacted_field_count, 4);
    assert.equal(event.payload.client_secret, undefined);
    assert.equal(event.payload.headers, undefined);
    assert.doesNotMatch(
      JSON.stringify(event),
      /SECRET_CANARY|PRIVATE_THOUGHT|buyer@example/,
    );
    store.db.pragma("wal_checkpoint(TRUNCATE)");
    assert.doesNotMatch(
      readFileSync(path).toString(),
      /SECRET_CANARY|PRIVATE_THOUGHT|buyer@example/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects free-form content and sensitive-looking identifiers", () => {
  assert.throws(() => parseEvent(input("sk-secret")));
  assert.throws(() =>
    parseEvent(
      input("e", {
        payload: { ...input().payload, merchant_id: "buyer@example.com" },
      }),
    ),
  );
  assert.throws(() =>
    parseEvent(
      input("e", {
        payload: { ...input().payload, merchant_id: { secret: "no" } },
      }),
    ),
  );
});

test("derives trace, policy, provenance and receipt order server-side", () =>
  usingStore((store) => {
    const run = store.createRun("business");
    store.append(run.run_id, [
      input("e1"),
      input("e2", { timestamp: "2026-11-09T11:00:00Z" }),
    ]);
    const detail = store.detail(run.run_id);
    assert.deepEqual(
      detail.events.map((e) => e.sequence),
      [1, 2],
    );
    assert.equal(detail.events[0].trace_id, run.trace_id);
    assert.equal(detail.events[0].policy_version, run.policy.version);
    assert.deepEqual(detail.events[0].provenance, {
      source: "external_ingestion",
      mode: "external",
      trusted: false,
    });
    assert.equal(detail.run.event_count, 2);
  }));

test("retries are idempotent even when JSON keys arrive in a different order", () =>
  usingStore((store) => {
    const run = store.createRun("consumer");
    const event = input();
    assert.deepEqual(store.append(run.run_id, [event]), {
      inserted: 1,
      duplicates: 0,
    });
    const reordered = {
      ...event,
      payload: {
        quantity: 1,
        currency: "USD",
        total_amount_minor: 14900,
        unit_amount_minor: 14900,
        merchant_id: "approved_sports",
        product_id: "shoe_1",
      },
    };
    assert.deepEqual(store.append(run.run_id, [reordered]), {
      inserted: 0,
      duplicates: 1,
    });
    assert.equal(store.detail(run.run_id).events.length, 1);
  }));

test("ID conflicts roll back the entire batch without consuming sequence numbers", () =>
  usingStore((store) => {
    const run = store.createRun("consumer");
    store.append(run.run_id, [input("existing")]);
    assert.throws(
      () =>
        store.append(run.run_id, [
          input("fresh"),
          input("existing", { actor: "human" }),
        ]),
      (error: unknown) => error instanceof StoreError && error.status === 409,
    );
    assert.equal(store.detail(run.run_id).events.length, 1);
    store.append(run.run_id, [input("after")]);
    assert.deepEqual(
      store.detail(run.run_id).events.map((e) => e.sequence),
      [1, 2],
    );
  }));

test("a malformed batch cannot partially persist", () =>
  usingStore((store) => {
    const run = store.createRun("consumer");
    assert.throws(() =>
      store.append(run.run_id, [input("valid"), { schema_version: 99 }]),
    );
    assert.equal(store.detail(run.run_id).events.length, 0);
  }));

test("events cannot be attached to unknown runs or reused across runs", () =>
  usingStore((store) => {
    assert.throws(
      () => store.append("missing", [input()]),
      (e: unknown) => e instanceof StoreError && e.status === 404,
    );
    const first = store.createRun("consumer"),
      second = store.createRun("business");
    store.append(first.run_id, [input()]);
    assert.throws(
      () => store.append(second.run_id, [input()]),
      (e: unknown) => e instanceof StoreError && e.status === 409,
    );
  }));

test("synthetic fixtures for both personas are labeled and cannot accept external events", () =>
  usingStore((store) => {
    for (const persona of ["consumer", "business"] as const) {
      for (const scenario of ["deviation", "authorized"] as const) {
        const run = store.createSynthetic(persona, scenario, scenarioEvents);
        const detail = store.detail(run.run_id);
        assert.equal(detail.events.length, 7);
        assert.ok(
          detail.events.every(
            (e) => e.provenance.mode === "synthetic" && !e.provenance.trusted,
          ),
        );
        assert.ok(
          detail.events.every(
            (e) => e.event_type !== "payment_status_recorded",
          ),
        );
        const proposal = detail.events.find(
          (e) => e.event_type === "purchase_proposed",
        )!;
        assert.equal(
          discrepancies(run, proposal).length,
          scenario === "deviation" ? 2 : 0,
        );
        assert.throws(
          () => store.append(run.run_id, [input()]),
          /synthetic recording/,
        );
      }
    }
  }));

test("synthetic run creation rolls back if fixture validation fails", () =>
  usingStore((store) => {
    assert.throws(() =>
      store.createSynthetic("consumer", "deviation", () => [
        { schema_version: 100 },
      ]),
    );
    assert.equal(store.listRuns().length, 0);
  }));

test("records and immutable policy snapshot survive closing and reopening SQLite", () => {
  const dir = mkdtempSync(join(tmpdir(), "rogue-persistence-"));
  const path = join(dir, "blackbox.sqlite");
  let store = new BlackBoxStore(path);
  try {
    const run = store.createRun("consumer");
    store.append(run.run_id, [input()]);
    const before = store.detail(run.run_id);
    store.close();
    store = new BlackBoxStore(path);
    assert.deepEqual(store.detail(run.run_id), before);
    assert.equal(store.db.pragma("user_version", { simple: true }), 0);
    assert.equal(
      (
        store.db.prepare("SELECT COUNT(*) n FROM schema_migrations").get() as {
          n: number;
        }
      ).n,
      5, // All non-destructive schema migrations are applied exactly once.
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diagnoses missing parents, clock inversions, late parents and cycles", () =>
  usingStore((store) => {
    const run = store.createRun("consumer");
    store.append(run.run_id, [
      input("child", {
        parent_event_id: "later",
        timestamp: "2026-11-09T10:00:00Z",
      }),
      input("orphan", { parent_event_id: "absent" }),
      input("later", {
        parent_event_id: "child",
        timestamp: "2026-11-09T11:00:00Z",
      }),
    ]);
    const codes = store.detail(run.run_id).gaps.map((g) => g.code);
    for (const code of [
      "missing_parent",
      "clock_inversion",
      "late_parent",
      "parent_cycle",
    ])
      assert.ok(codes.includes(code));
    assert.throws(() => parseEvent(input("self", { parent_event_id: "self" })));
  }));

test("diagnoses unclosed tool requests and missing expected evidence without inventing events", () =>
  usingStore((store) => {
    const run = store.createRun("business");
    store.append(run.run_id, [
      input("start", {
        event_type: "tool_call_started",
        payload: { operation: "catalog.search", request_id: "req_1" },
      }),
    ]);
    const detail = store.detail(run.run_id);
    assert.ok(detail.gaps.some((g) => g.code === "missing_tool_response"));
    assert.ok(detail.gaps.some((g) => g.code === "absent_mandate_recorded"));
    assert.ok(detail.gaps.some((g) => g.code === "payment_not_observed"));
    assert.ok(detail.gaps.some((g) => g.code === "unverified_source"));
    assert.equal(detail.events.length, 1);
    store.append(run.run_id, [
      input("end", {
        event_type: "tool_call_completed",
        payload: {
          operation: "catalog.search",
          request_id: "req_1",
          result: "success",
        },
      }),
    ]);
    assert.ok(
      !store
        .detail(run.run_id)
        .gaps.some((g) => g.code === "missing_tool_response"),
    );
  }));

test("reference comparisons preserve exact money and never describe enforcement", () =>
  usingStore((store) => {
    const run = store.createRun("consumer");
    for (const amount of [14900, 15000, 15100]) {
      store.append(run.run_id, [
        input(`amount_${amount}`, {
          payload: {
            ...input().payload,
            unit_amount_minor: amount,
            total_amount_minor: amount,
          },
        }),
      ]);
    }
    const events = store.detail(run.run_id).events;
    assert.deepEqual(
      events.map((e) => discrepancies(run, e).length),
      [0, 0, 1],
    );
    assert.ok(
      visibilityGaps(run, events).some((g) => g.code === "policy_not_observed"),
    );
  }));

test("order_created and captured remain distinct reported statuses", () =>
  usingStore((store) => {
    const run = store.createRun("consumer");
    store.append(run.run_id, [
      input("order", {
        actor: "paypal",
        event_type: "payment_status_recorded",
        payload: { state: "order_created", order_reference: "sender_claim_1" },
      }),
    ]);
    const event = store.detail(run.run_id).events[0];
    assert.equal(event.payload.state, "order_created");
    assert.equal(event.provenance.trusted, false);
    assert.notEqual(event.payload.state, "captured");
  }));
