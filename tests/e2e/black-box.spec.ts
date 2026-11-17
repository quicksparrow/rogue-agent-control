import { test, expect } from "@playwright/test";

test("judge can record, inspect, search, navigate parents, explore and reload", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Black Box" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No recordings yet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record consumer fixture" }).click();
  await expect(
    page.getByText("SYNTHETIC RECORDING", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect event 5: Purchase proposed" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("complementary", { name: "Evidence inspector" })
      .getByRole("heading", { name: "Purchase proposed" }),
  ).toBeVisible();
  await expect(
    page.getByText("Mandate discrepancies", { exact: true }),
  ).toBeVisible();
  const recordingId = await page.locator("#recording-select").inputValue();
  await page.getByRole("textbox", { name: "Search events" }).fill("untrusted");
  await expect(
    page.getByRole("button", {
      name: "Inspect event 3: Untrusted listing observed",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect event 5: Purchase proposed" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Inspect event 3: Untrusted listing observed",
    })
    .click();
  await expect(
    page.getByText("REVIEWED FIXTURE REFERENCE", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "#02 Catalog results received" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search events" }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", {
      name: "Inspect event 2: Catalog results received",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("combobox", { name: "Filter by actor" })
    .selectOption("shopping_agent");
  await expect(
    page.getByRole("button", { name: /^Inspect event \d+:/ }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(page.getByTestId("event-grid").getByRole("grid")).toBeVisible();
  await page
    .getByRole("gridcell", { name: "Purchase proposed", exact: true })
    .click();
  await expect(
    page
      .getByTestId("evidence-inspector")
      .getByRole("heading", { name: "Purchase proposed" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("#recording-select")).toHaveValue(recordingId);
  await expect(
    page.getByRole("button", { name: "Inspect event 5: Purchase proposed" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/black-box-desktop.png",
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
});

test("business and within-mandate fixtures use the same recorder; mobile has no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New recording" }).click();
  await page.getByLabel("Shopping persona").selectOption("business");
  await page.getByLabel("Recorded outcome").selectOption("authorized");
  await page.getByRole("button", { name: "Record synthetic scenario" }).click();
  await expect(page.getByText("B2B PURCHASING", { exact: true })).toBeVisible();
  await expect(page.getByText("$899.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Mandate discrepancies", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inspect event 7: Recording finished" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    view: window.innerWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.view);
  await page.getByRole("button", { name: "New recording" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New recording" }).click();
  await page.getByLabel("Shopping persona").selectOption("business");
  await page.getByRole("button", { name: "Record synthetic scenario" }).click();
  await expect(page.getByText("$1,299.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Mandate discrepancies", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/black-box-mobile.png",
    fullPage: true,
  });
});

test("HTTP collection persists unverified events, rejects spoofing and does not touch integrations", async ({
  request,
  page,
}) => {
  const create = await request.post("/api/runs", {
    data: { persona: "consumer" },
  });
  expect(create.status()).toBe(201);
  const { run } = await create.json();
  const event = {
    schema_version: 1,
    event_id: `evt_api_${Date.now()}`,
    parent_event_id: "evt_missing_parent",
    timestamp: new Date().toISOString(),
    actor: "shopping_agent",
    event_type: "purchase_proposed",
    payload: {
      product_id: "shoe_api",
      merchant_id: "approved_sports",
      unit_amount_minor: 12900,
      total_amount_minor: 12900,
      quantity: 1,
      currency: "USD",
      client_secret: "CANARY_API_SECRET",
      prompt: "PRIVATE_PROMPT_CANARY",
    },
  };
  const append = await request.post(`/api/runs/${run.run_id}/events`, {
    data: { events: [event] },
  });
  expect(append.status()).toBe(201);
  const retry = await request.post(`/api/runs/${run.run_id}/events`, {
    data: { events: [event] },
  });
  expect(await retry.json()).toEqual({ inserted: 0, duplicates: 1 });
  const spoofed = await request.post(`/api/runs/${run.run_id}/events`, {
    data: { events: [{ ...event, provenance: { trusted: true } }] },
  });
  expect(spoofed.status()).toBe(400);
  const crossOrigin = await request.post("/api/demos", {
    headers: { Origin: "http://foreign.invalid" },
    data: { persona: "consumer" },
  });
  expect(crossOrigin.status()).toBe(403);
  const unknown = await request.get("/api/runs/run_absent");
  expect(unknown.status()).toBe(404);
  const result = await (await request.get(`/api/runs/${run.run_id}`)).json();
  expect(result.events).toHaveLength(1);
  expect(result.events[0].provenance).toEqual({
    source: "external_ingestion",
    mode: "external",
    trusted: false,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /CANARY_API_SECRET|PRIVATE_PROMPT_CANARY/,
  );
  expect(
    result.gaps.some((g: { code: string }) => g.code === "missing_parent"),
  ).toBe(true);
  const outbound: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith("http://127.0.0.1:3101"))
      outbound.push(req.url());
  });
  await page.goto("/");
  await page.locator("#recording-select").selectOption(run.run_id);
  await expect(
    page.getByText("EXTERNAL · UNVERIFIED", { exact: true }).first(),
  ).toBeVisible();
  // Selecting the already active run must keep its loaded evidence visible.
  await page.locator("#recording-select").selectOption(run.run_id);
  await expect(
    page.getByText("EXTERNAL · UNVERIFIED", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Waiting for evidence", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Inspect event 1: Purchase proposed" })
    .click();
  await expect(
    page.getByText(/Parent evt_missing_parent is absent/),
  ).toBeVisible();
  await page.locator(".visibility-panel").getByRole("button", { name: "Inspect event" }).first().click();
  await expect(page.getByLabel("Persisted event JSON")).toContainText("evt_missing_parent");
  expect(outbound).toEqual([]);
});
