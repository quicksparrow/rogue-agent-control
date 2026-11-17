import { test, expect } from "@playwright/test";
import type { PaymentView } from "../../src/lib/payment-contracts";
// UI-only provider-state fixtures. Real financial calls are disabled by the browser server environment.
function view(proposal_id: string, state: PaymentView["state"]): PaymentView {
  return {
    proposal_id,
    run_id: "run_mock_browser",
    state,
    available: true,
    reason_codes: ["RULES_SATISFIED"],
    sandbox: true,
    no_real_money: true,
    retailer_fulfillment: false,
    order_id: state === "eligible" ? null : "MOCKORDER12345",
    capture_id: state === "captured" ? "MOCKCAPTURE1234" : null,
    capture_status: state === "captured" ? "COMPLETED" : null,
    provider_status:
      state === "eligible"
        ? null
        : state === "buyer_approved"
          ? "APPROVED"
          : state === "captured"
            ? "COMPLETED"
            : "CREATED",
    approval_url:
      state === "buyer_approval_pending"
        ? "https://www.sandbox.paypal.com/checkoutnow?token=MOCKORDER12345"
        : null,
    seller_mapping_version: "sandbox_mock_mapping",
    create_request_id: "mock_create_id",
    capture_request_id: "mock_capture_id",
    error_code: null,
    provider_error_code: null,
    approval_verified_at:
      state === "buyer_approved" ? "2026-11-10T00:00:00.000Z" : null,
    can_create: state === "eligible",
    can_verify: state === "buyer_approval_pending",
    can_capture: state === "buyer_approved",
    can_cancel: state === "buyer_approval_pending",
    can_retry_create: false,
    payment_captured: state === "captured",
  };
}
test("sandbox UI separates create, provider approval verification and explicit capture using mocked HTTP responses", async ({
  page,
}) => {
  const id = "proposal_browser_ui_mock",
    operations: string[] = [];
  let state: PaymentView["state"] = "eligible";
  await page.route("**/api/gateway/paypal*", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(Object.keys(body).sort()).toEqual(["operation", "proposal_id"]);
      expect(body.proposal_id).toBe(id);
      operations.push(body.operation);
      state =
        body.operation === "create"
          ? "buyer_approval_pending"
          : body.operation === "verify"
            ? "buyer_approved"
            : "captured";
    }
    await route.fulfill({ json: { payment: view(id, state) } });
  });
  await page.goto(`/checkout?proposal_id=${id}`);
  await expect(
    page.getByText("Sandbox checkout. No real money.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Capture Sandbox Payment", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create Sandbox Order", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "buyer approval pending",
  );
  await expect(
    page.getByRole("link", { name: /Approve with Sandbox Buyer/ }),
  ).toHaveAttribute("href", /https:\/\/www\.sandbox\.paypal\.com\/checkoutnow/);
  await expect(
    page.getByRole("button", { name: "Capture Sandbox Payment", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Verify / reconcile order", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("buyer approved");
  await page
    .getByRole("button", { name: "Capture Sandbox Payment", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Sandbox capture confirmed",
  );
  expect(operations).toEqual(["create", "verify", "capture"]);
});
test("redirect and cancellation query flags cannot establish approval or automatically submit capture", async ({
  page,
}) => {
  const id = "proposal_callback_mock";
  let posts = 0;
  await page.route("**/api/gateway/paypal*", async (route) => {
    if (route.request().method() === "POST") posts++;
    await route.fulfill({
      json: { payment: view(id, "buyer_approval_pending") },
    });
  });
  await page.goto(
    `/checkout?proposal_id=${id}&approved=true&token=UNTRUSTED_TOKEN&cancel=1`,
  );
  await expect(page.getByText(/URL indicates cancellation/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Capture Sandbox Payment", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel locally", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(0);
});
test("actual API rejects synthetic checkout and mobile sandbox references do not overflow", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/firewall/scenarios", {
      data: { scenario: "allowed" },
    }),
    fixture = await response.json();
  const result = await request.post("/api/gateway/paypal", {
    data: { proposal_id: fixture.proposal.proposal_id, operation: "create" },
  });
  expect(result.status()).toBe(409);
  expect((await result.json()).error_code).toBe("SYNTHETIC_NOT_EXECUTABLE");
  const id = "proposal_mobile_mock";
  await page.route("**/api/gateway/paypal*", async (route) =>
    route.fulfill({ json: { payment: view(id, "buyer_approval_pending") } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/checkout?proposal_id=${id}`);
  await expect(
    page.getByRole("button", { name: "Verify / reconcile order", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("mock checkout retry, buyer link, local cancellation and evidence navigation", async ({ page, context }) => {
  const id = "proposal_mock_retry_cancel";
  let current = { ...view(id, "unknown_reconciling"), can_retry_create: true };
  const calls: string[] = [];
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  // Consume the new-tab navigation inside Chromium. Never connect to PayPal.
  let buyerNavigations = 0;
  await context.route("https://www.sandbox.paypal.com/**", async route => {
    buyerNavigations++;
    await route.fulfill({ contentType: "text/plain", body: "Mock buyer page" });
  });
  await page.route("**/api/gateway/paypal*", async route => {
    if (route.request().method() === "POST") {
      const { operation, proposal_id } = route.request().postDataJSON();
      expect(proposal_id).toBe(id);
      calls.push(operation);
      if (operation === "retry_create") {
        await pending;
        current = view(id, "buyer_approval_pending");
      } else {
        expect(operation).toBe("cancel");
        current = view(id, "cancelled");
      }
    }
    await route.fulfill({ json: { payment: current } });
  });
  await page.goto("/checkout?proposal_id=" + id);
  const retry = page.getByRole("button", { name: /Retry same Sandbox Order request/i });
  await retry.dblclick();
  await expect(page.locator(".sandbox-actions button")).toBeDisabled();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls).toEqual(["retry_create"]);
  release();
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: /Approve with Sandbox Buyer/ }).click();
  const buyerPage = await popup;
  await expect(buyerPage.locator("body")).toContainText("Mock buyer page");
  await buyerPage.close();
  expect(buyerNavigations).toBe(1);
  await page.getByRole("button", { name: /Cancel locally/i }).click();
  await expect(page.getByRole("status")).toContainText("cancelled");
  expect(calls).toEqual(["retry_create", "cancel"]);
  await page.locator("summary").filter({ hasText: /operation references/i }).click();
  await expect(page.getByText("mock_create_id")).toBeVisible();
  await page.getByRole("link", { name: /Inspect payment evidence in Black Box/i }).click();
  await expect(page).toHaveURL(/\/?\?run=run_mock_browser$/);
});

test("each sandbox operation locks while pending and restores controls on a mock failure", async ({ page }) => {
  const cases = [
    ["create", "eligible", "Create Sandbox Order"],
    ["verify", "buyer_approval_pending", "Verify / reconcile order"],
    ["capture", "buyer_approved", "Capture Sandbox Payment"],
    ["cancel", "buyer_approval_pending", "Cancel locally"],
    ["retry_create", "unknown_reconciling", "Retry same Sandbox Order request"],
  ] as const;
  for (const [operation, state, label] of cases) {
    const id = "proposal_mock_error_" + operation;
    let requests = 0;
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/gateway/paypal*", async route => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { payment: { ...view(id, state), can_retry_create: operation === "retry_create" } } });
        return;
      }
      requests++;
      expect(route.request().postDataJSON()).toEqual({ operation, proposal_id: id });
      await pending;
      await route.fulfill({ status: 503, json: { error: "Mock operation unavailable" } });
    });
    await page.goto("/checkout?proposal_id=" + id);
    const trigger = page.getByRole("button", { name: label, exact: true });
    await trigger.dblclick();
    await expect.poll(() => requests).toBe(1);
    for (const button of await page.locator(".sandbox-actions button").all()) {
      await expect(button).toBeDisabled();
    }
    release();
    await expect(page.locator("main [role=alert]")).toContainText("Mock operation unavailable");
    await expect(trigger).toBeEnabled();
    expect(requests).toBe(1);
    await page.unroute("**/api/gateway/paypal*");
  }
});
