import { test } from "node:test";
import assert from "node:assert/strict";
import { localOnly, readJson, HttpError, apiError } from "../src/server/http";

test("permits loopback requests and rejects foreign origin or host", () => {
  localOnly(new Request("http://127.0.0.1:3000/api/runs"));
  localOnly(
    new Request("http://localhost:3000/api/runs", {
      headers: { origin: "http://localhost:3000", host: "localhost:3000" },
    }),
  );
  const invalidHeaders: Record<string, string>[] = [
    { host: "attacker.example" },
    { origin: "http://attacker.example" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const headers of invalidHeaders) {
    assert.throws(
      () =>
        localOnly(new Request("http://127.0.0.1:3000/api/runs", { headers })),
      (e: unknown) => e instanceof HttpError && e.status === 403,
    );
  }
});

test("requires bounded JSON content and sanitizes parser/storage errors", async () => {
  for (const [headers, body, status] of [
    [{ "content-type": "text/plain" }, "{}", 415],
    [{ "content-type": "application/json" }, "{broken", 400],
    [
      { "content-type": "application/json", "content-length": "999999" },
      "{}",
      413,
    ],
  ] as const) {
    await assert.rejects(
      readJson(
        new Request("http://localhost/api/runs", {
          method: "POST",
          headers,
          body,
        }),
      ),
      (e: unknown) => e instanceof HttpError && e.status === status,
    );
  }
  assert.deepEqual(
    await readJson(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"persona":"consumer"}',
      }),
    ),
    { persona: "consumer" },
  );
  const response = apiError(new Error("SECRET_CANARY"));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SECRET_CANARY/);
});

test("enforces the byte limit even without content-length", async () => {
  await assert.rejects(
    readJson(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ huge: "a".repeat(270000) }),
      }),
    ),
    (e: unknown) => e instanceof HttpError && e.status === 413,
  );
});
