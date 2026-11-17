import { test, expect } from "@playwright/test";
test("guided no-key demo keeps synthetic labels, searches Community grid and follows citations", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!["127.0.0.1", "localhost"].includes(new URL(r.url()).hostname))
      external.push(r.url());
  });
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Scenario explorer" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Practice Quantity Controls/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic quantity exercise" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "REVIEW", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "DENY", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("event-grid")).toBeVisible();
  await page.getByRole("gridcell").first().press("Enter");
  await expect(page.getByLabel("Persisted event JSON")).toContainText(
    '"sequence": 1',
  );
  await page
    .getByLabel("Search events and IDs")
    .fill("policy_decision_recorded");
  await expect(page.getByRole("grid")).toBeVisible();
  await page.locator(".citation-button").first().click();
  await expect(page.getByLabel("Persisted event JSON")).toBeVisible();
  await expect(page.getByLabel("Search events and IDs")).toHaveValue("");
  expect(external).toEqual([]);
});
test("scenario switching preserves unavailable versus synthetic and mobile controls", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await page
    .getByRole("button", { name: /Synthetic Policy Violation/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Controlled over-budget proposal" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const r = await request.post("/api/demo", {
    data: { scenario: "authorized", capture: true },
  });
  expect(r.status()).toBe(405);
  await page
    .getByRole("button", { name: /Authorized Sandbox Purchase/ })
    .click();
  await expect(page.getByText("Opening preserved evidence…")).toHaveCount(0);
});
