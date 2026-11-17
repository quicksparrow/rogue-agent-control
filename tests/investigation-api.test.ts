import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "../src/app/api/investigation/route";
import { POST as replayPost } from "../src/app/api/replay/route";
import { getStore } from "../src/server/store";
import { createFirewallScenario } from "../src/server/firewall/scenarios";
const dir = mkdtempSync(join(tmpdir(), "investigate-")),
  old = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(dir, "db.sqlite");
after(() => {
  getStore().close();
  delete (globalThis as typeof globalThis & { rogueStore?: unknown })
    .rogueStore;
  if (old === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = old;
  rmSync(dir, { recursive: true, force: true });
});
function request(path: string, body?: unknown, origin?: string) {
  return new Request("http://127.0.0.1:3000" + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test("investigation API reads deterministic evidence without network; rejects invalid IDs and origin", async () => {
  const r = createFirewallScenario(getStore(), "over_budget");
  const fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error();
  };
  try {
    const a = await GET(request(`/api/investigation?run_id=${r.run.run_id}`));
    assert.equal(a.status, 200);
    assert.equal((await a.json()).evidence.status, "incident");
    assert.equal(calls, 0);
    assert.equal(
      (await GET(request("/api/investigation?run_id=bad%20id"))).status,
      400,
    );
    assert.equal(
      (
        await POST(
          request(
            "/api/investigation",
            { run_id: r.run.run_id },
            "https://evil.invalid",
          ),
        )
      ).status,
      403,
    );
  } finally {
    globalThis.fetch = fetch;
  }
});
test("concurrent replay API calls persist separate simulations with no payment/network calls", async () => {
  const r = createFirewallScenario(getStore(), "quantity_mismatch"),
    before = JSON.stringify(getStore().detail(r.run.run_id));
  const fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("Forbidden");
  };
  try {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        replayPost(
          request("/api/replay", {
            run_id: r.run.run_id,
            proposal_id: r.proposal.proposal_id,
            alternative: { quantity_mismatch: "DENY" },
          }),
        ),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).artifact.comparison.replayed.outcome,
        "DENY",
      );
    }
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(getStore().detail(r.run.run_id)), before);
  } finally {
    globalThis.fetch = fetch;
  }
});
test("replay dependency path contains no payment/shopping/model adapters", () => {
  for (const file of ["replay.ts", "replay-service.ts", "evidence.ts"]) {
    const source = readFileSync("src/server/investigation/" + file, "utf8");
    assert.ok(
      !/from\s+["'][^"']*(?:payments|shopping\/ollama|shopping\/catalog|firewall\/gateway)/.test(
        source,
      ),
    );
  }
});
