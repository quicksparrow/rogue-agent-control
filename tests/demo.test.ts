import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { demoSnapshot } from "../src/server/demo";
import { disposableResetTarget } from "../src/server/reset-safety";
import { GET } from "../src/app/api/demo/route";
test("clean checkout demo explicitly marks genuine recordings unavailable; no silent simulation", () => {
  const root = mkdtempSync(join(tmpdir(), "demo-clean-"));
  try {
    for (const id of ["quantity", "authorized"] as const) {
      const r = demoSnapshot(id, root);
      assert.equal(r.available, false);
      assert.equal(r.source, "unavailable");
      assert.equal(r.detail, undefined);
    }
    assert.equal(existsSync(join(root, "data")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("no-key synthetic policy and quantity exercises use real evaluator with zero network or disk writes", () => {
  const root = mkdtempSync(join(tmpdir(), "demo-safe-")),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Forbidden demo network");
  };
  try {
    const denied = demoSnapshot("violation", root),
      practice = demoSnapshot("practice", root);
    assert.equal(denied.source, "isolated_synthetic");
    assert.equal(denied.detail?.run.mode, "synthetic");
    assert.equal(denied.comparison?.baseline.outcome, "DENY");
    assert.equal(practice.comparison?.baseline.outcome, "REVIEW");
    assert.equal(practice.comparison?.replayed.outcome, "DENY");
    assert.deepEqual(demoSnapshot("practice", root), practice);
    assert.equal(calls, 0);
    assert.equal(existsSync(join(root, "data")), false);
  } finally {
    globalThis.fetch = original;
    rmSync(root, { recursive: true, force: true });
  }
});
test("demo API rejects paths, unknown scenarios, duplicate IDs, mutation authority and origins", async () => {
  for (const query of [
    "scenario=../../secret",
    "scenario=unknown",
    "scenario=quantity&scenario=authorized",
    "scenario=violation&path=data/phase4-sandbox.sqlite",
    "scenario=violation&capture=true",
  ])
    assert.equal(
      (await GET(new Request("http://127.0.0.1:3000/api/demo?" + query)))
        .status,
      400,
    );
  assert.equal(
    (
      await GET(
        new Request("http://127.0.0.1:3000/api/demo?scenario=violation", {
          headers: { Origin: "https://evil.invalid" },
        }),
      )
    ).status,
    403,
  );
});
test("reset safety refuses every historical/default path, traversal and outside-workspace target", () => {
  const root = process.cwd();
  for (const path of [
    "data/rogue-control.sqlite",
    "data/phase3-smoke.sqlite",
    "data/phase4-sandbox.sqlite",
    "data/phase2-smoke.sqlite",
    "../disposable-demo.sqlite",
    "data/../disposable-demo.sqlite",
    "C:/disposable-demo.sqlite",
  ])
    assert.throws(() => disposableResetTarget(root, path));
  assert.ok(
    disposableResetTarget(root, "data/disposable-demo-test.sqlite").endsWith(
      "disposable-demo-test.sqlite",
    ),
  );
});
