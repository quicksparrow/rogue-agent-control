import { test, expect } from "@playwright/test";
test("Black Box investigation, exact citations, quantity replay and visible unavailable-model outcome", async ({
  page,
  request,
}) => {
  const result = await (
    await request.post("/api/firewall/scenarios", {
      data: { scenario: "quantity_mismatch" },
    })
  ).json();
  await page.goto(`/?run=${result.run.run_id}`);
  await page.getByRole("link", { name: "Investigate", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Incident overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Severity:" }),
  ).toContainText("incident");
  await page
    .getByRole("button", { name: "Compare policies without execution" })
    .click();
  await expect(
    page.getByText("Baseline matches recorded decision: true"),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({hasText:"Firewall decision"}).getByRole("cell", { name: "DENY", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({hasText:"Firewall decision"}).getByRole("cell", { name: "REVIEW", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generate Qwen3 report" }).click();
  await expect(page.getByText(/Report outcome: failed/)).toBeVisible();
  await page.locator(".investigation-citations a").first().click();
  await expect(page.getByTestId("evidence-inspector")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("event")).toBeTruthy();
});
test("investigation mobile preserves simulation labels and has no overflow", async ({
  page,
  request,
}) => {
  const result = await (
    await request.post("/api/firewall/scenarios", {
      data: { scenario: "over_budget" },
    })
  ).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/investigate?run=${result.run.run_id}`);
  await expect(
    page.getByRole("heading", { name: "Deterministic replay" }),
  ).toBeVisible();
  await expect(
    page.getByText("Hypothetical simulation. No executable authorization.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
