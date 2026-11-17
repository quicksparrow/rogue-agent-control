import { test, expect } from "@playwright/test";

test("shopping form validates exact money and captures a B2B mandate through real local API", async ({
  page,
  request,
}) => {
  await page.goto("/shopping");
  await expect(
    page.getByRole("heading", { name: "Shopping agent." }),
  ).toBeVisible();
  await expect(
    page.getByText("Model unavailable", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Shopping scenario").selectOption("business");
  await expect(page.getByLabel("Quantity per alternative")).toHaveValue("10");
  await page.getByLabel("Total budget", { exact: true }).fill("19.999");
  await page
    .getByRole("button", { name: "Run shopping agent", exact: true })
    .click();
  await expect(
    page.getByText("Enter a positive budget with at most two decimal places.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Total budget", { exact: true }).fill("250.00");
  await page
    .getByRole("button", { name: "Run shopping agent", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Execution failed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be reached" }),
  ).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("run")!;
  const result = await (await request.get(`/api/shopping/${runId}`)).json();
  expect(result.execution.mandate.quantity).toBe(10);
  expect(result.execution.mandate.budget_minor).toBe(25000);
  expect(result.execution.mandate.identity.owner_id).toBe("local_buyer");
  expect(result.execution.mandate.identity.authenticated).toBe(false);
  expect(result.execution.status).toBe("failed");
  const detail = await (await request.get(`/api/runs/${runId}`)).json();
  expect(
    detail.events.every(
      (e: { provenance: { mode: string } }) =>
        e.provenance.mode === "integration",
    ),
  ).toBe(true);
  expect(
    detail.events.some(
      (e: { event_type: string }) => e.event_type === "execution_failed",
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Open Black Box", exact: true })
    .last()
    .click();
  await expect(page.locator("#recording-select")).toHaveValue(runId);
  await expect(
    page.getByRole("button", {
      name: /Inspect event \d+: Shopping execution failed/,
    }),
  ).toBeVisible();
});

test("Channel3 selection stays explicit on failure and the shopping layout works on mobile", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/shopping");
  await page.getByLabel("Catalog mode").selectOption("channel3");
  await expect(page.getByLabel("Reference merchant IDs")).toHaveValue(
    "amazon.com",
  );
  await page
    .getByRole("button", { name: "Run shopping agent", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Execution failed", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Catalog mode")).toHaveValue("channel3");
  await expect(
    page.getByText("CHANNEL3 LIVE SELECTED", { exact: true }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    view: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.view);
  const runId = new URL(page.url()).searchParams.get("run")!;
  const repeat = await request.post(`/api/shopping/${runId}/execute`, {
    data: {},
  });
  expect(repeat.status()).toBe(409);
  const spoof = await request.post("/api/shopping", {
    data: { persona: "consumer", owner_id: "attacker" },
  });
  expect(spoof.status()).toBe(400);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Execution failed", exact: true }),
  ).toBeVisible();
});
