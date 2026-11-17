import { expect, test, type Page } from "@playwright/test";

// Hold a request open until the browser has exposed its pending state.
function latch() {
  let release = () => {};
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

async function activateDisclosure(page: Page, name: RegExp) {
  const summary = page.locator("summary").filter({ hasText: name }).first();
  await summary.focus();
  await summary.press("Enter");
  await expect(summary.locator("..")).toHaveJSProperty("open", true);
  await summary.press("Space");
  await expect(summary.locator("..")).toHaveJSProperty("open", false);
}

test("navigation, skip links, checkout return and named destinations work by keyboard", async ({ page }) => {
  await page.goto("/demo");
  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  for (const path of ["/shopping", "/firewall", "/checkout", "/investigate", "/", "/demo"]) {
    const item = page.locator('nav a[href="' + path + '"]').first();
    await item.focus();
    await item.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.getByRole("link", { name: "Rogue Agent Control home" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  await page.goto("/checkout");
  await page.getByRole("link", { name: /Return to shopping agent/i }).click();
  await expect(page).toHaveURL(/\/shopping$/);
  await page.locator('main a[href="/firewall"]').click();
  await expect(page).toHaveURL(/\/firewall$/);
  await page.locator('main a[href="/shopping"]').click();
  await expect(page).toHaveURL(/\/shopping$/);
  await page.locator('main a[href="/"]').first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("mobile navigation opens by keyboard, dismisses, and identifies the current page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  const toggle = page.locator("button[aria-controls='workspace-navigation']");
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const nav = page.locator("#workspace-navigation");
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", "/demo");
  await nav.getByRole("link").first().focus();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await nav.locator('a[href="/checkout"]').click();
  await expect(page).toHaveURL(/\/checkout$/);
  await toggle.click();
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", "/checkout");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("empty-store retry, B2B quick record, refresh, dialog focus and event filtering", async ({ page }) => {
  let listFails = true;
  await page.route("**/api/runs", (route) => route.fulfill(
    listFails ? { status: 503, json: { error: "Temporary collection outage" } } : { json: { runs: [] } },
  ));
  await page.goto("/");
  await expect(page.locator("main [role=alert]")).toContainText("Temporary collection outage");
  listFails = false;
  await page.getByRole("button", { name: /Retry/i }).click();
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
  await page.unroute("**/api/runs");
  await page.getByRole("button", { name: "Record B2B fixture" }).click();
  const recording = page.locator("#recording-select");
  await expect(recording).not.toHaveValue("");
  const active = await recording.inputValue();
  const read = page.waitForResponse(r => r.url().endsWith("/api/runs/" + active));
  await page.getByRole("button", { name: "Refresh recordings" }).click();
  await read;
  await expect(recording).toHaveValue(active);
  const open = page.getByRole("button", { name: "New recording" });
  await open.click();
  await page.getByRole("button", { name: "Close recording dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(open).toBeFocused();
  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search events" });
  await expect(search).toBeFocused();
  await search.fill("no-event-should-match-this");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(search).toHaveValue("");
  await activateDisclosure(page, /Run & trace correlation/i);
  await activateDisclosure(page, /Capture your own events/i);
  const gaps = page.locator(".visibility-panel");
  await gaps.locator("summary").click();
  await expect(gaps).toHaveJSProperty("open", false);
  await gaps.locator("summary").click();
  await expect(gaps).toHaveJSProperty("open", true);
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Inspect event 1:/ })).toBeVisible();
});

test("pending recording suppresses duplicate submission and retains the dialog on a recoverable error", async ({ page }) => {
  const pending = latch();
  let attempts = 0;
  await page.route("**/api/demos", async route => {
    attempts++;
    await pending.wait;
    await route.fulfill({ status: 503, json: { error: "Recorder temporarily unavailable" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New recording" }).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.locator('button[type="submit"]');
  await submit.dblclick();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByLabel("Shopping persona")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect.poll(() => attempts).toBe(1);
  pending.release();
  await expect(dialog.getByRole("alert")).toContainText("Recorder temporarily unavailable");
  await expect(submit).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("shopping refresh and mandate controls transmit the selected input once", async ({ page }) => {
  await page.goto("/shopping");
  const refresh = page.getByRole("button", { name: /Check status/i });
  await expect(refresh).toBeEnabled();
  const status = page.waitForResponse(r => r.url().endsWith("/api/integrations"));
  await refresh.click();
  await status;
  await expect(refresh).toBeEnabled();
  await page.getByLabel("Shopping scenario").selectOption("business");
  const policy = page.getByLabel("Owner policy version");
  await expect(policy).not.toHaveValue("");
  await policy.selectOption({ index: 0 });
  await page.locator("#shopping-objective").fill("Find three wireless mice for this browser test.");
  await page.getByLabel("Total budget", { exact: true }).fill("89.99");
  await page.locator("#shopping-currency").selectOption("EUR");
  await page.getByLabel("Quantity per alternative").fill("3");
  await page.locator("#shopping-preferences").fill("wireless, quiet");
  await page.getByLabel("Reference merchant IDs").fill("seed_office");
  const gate = latch();
  let calls = 0;
  await page.route("**/api/shopping", async route => {
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({
      budget_minor: 8999, currency: "EUR", quantity: 3, preferences: ["wireless", "quiet"],
      merchant_ids: ["seed_office"], persona: "business", catalog_mode: "offline",
      objective: "Find three wireless mice for this browser test.",
    });
    await gate.wait;
    await route.fulfill({ status: 503, json: { error: "Temporary shopping outage" } });
  });
  const submit = page.locator('form button[type="submit"]');
  await submit.dblclick();
  await expect(submit).toBeDisabled();
  await expect.poll(() => calls).toBe(1);
  gate.release();
  await expect(page.locator("main [role=alert]")).toContainText("Temporary shopping outage");
  await expect(submit).toBeEnabled();
});

test("policy editor transmits every restriction and recovers from a save failure", async ({ page }) => {
  await page.goto("/firewall");
  await expect(page.locator("#policy-version")).not.toHaveValue("");
  await page.locator("#policy-version").selectOption({ index: 1 });
  await page.locator("#policy-label").fill("Browser control audit");
  await page.locator("#policy-limit").fill("125.99");
  await page.locator("#policy-currency").selectOption("EUR");
  await page.locator("#policy-min").fill("2");
  await page.locator("#policy-max").fill("7");
  await page.locator("#quantity-mismatch").selectOption("REVIEW");
  await page.locator("#automatic-authority").fill("80.25");
  await page.getByLabel("Always require human review").check();
  const groups = page.locator("fieldset.merchant-choices");
  for (const group of await groups.all()) {
    for (const box of await group.getByRole("checkbox").all()) {
      await box.check();
      await box.uncheck();
    }
  }
  await groups.nth(0).getByRole("checkbox").first().check();
  await groups.nth(1).getByRole("checkbox").last().check();
  const gate = latch();
  let posts = 0;
  await page.route("**/api/policies", async route => {
    posts++;
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      currency: "EUR", label: "Browser control audit", min_quantity: 2, max_quantity: 7,
      quantity_mismatch: "REVIEW", require_human_approval: true,
      max_transaction_minor: 12599, automatic_approval_minor: 8025,
    });
    expect(body.approved_merchant_ids).toHaveLength(1);
    expect(body.prohibited_merchant_ids).toHaveLength(1);
    await gate.wait;
    await route.fulfill({ status: 409, json: { error: "Policy save unavailable" } });
  });
  const save = page.locator('form button[type="submit"]');
  await save.dblclick();
  await expect(save).toBeDisabled();
  await expect.poll(() => posts).toBe(1);
  gate.release();
  await expect(page.locator("main [role=alert]")).toContainText("Policy save unavailable");
  await expect(save).toBeEnabled();
});

test("investigation section navigation, alternative selection, saved artifacts and exact evidence identity", async ({ page, request }) => {
  const fixture = await (await request.post("/api/firewall/scenarios", {
    data: { scenario: "quantity_mismatch" },
  })).json();
  await page.goto("/investigate?run=" + fixture.run.run_id);
  for (const link of await page.getByRole("navigation", { name: "Investigation sections" }).getByRole("link").all()) {
    const href = await link.getAttribute("href");
    await link.click();
    expect(new URL(page.url()).hash).toBe(href);
  }
  await activateDisclosure(page, /Run and evidence snapshot/i);
  await activateDisclosure(page, /Other recorded observations/i);
  await page.getByLabel("Recorded proposal").selectOption(fixture.proposal.proposal_id);
  await page.getByLabel("What-if quantity mismatch rule").selectOption("REVIEW");
  await page.getByRole("button", { name: "Compare policies without execution" }).click();
  const outcome = page.getByRole("row").filter({ hasText: "Firewall decision" }).getByRole("cell", { name: "REVIEW", exact: true });
  await expect(outcome).toHaveCount(2);
  await activateDisclosure(page, /Historical investigation artifacts/i);
  const citation = page.locator(".investigation-citations a:visible").first();
  const url = new URL(await citation.getAttribute("href") ?? "", page.url());
  const citedId = url.searchParams.get("event");
  expect(citedId).toBeTruthy();
  await citation.press("Enter");
  const json = page.getByLabel("Persisted event JSON");
  await expect(json).toContainText(citedId!);
  expect(JSON.parse(await json.innerText()).event_id).toBe(citedId);
});

test("Community explorer sorting, filtering, scrolling and citation recovery", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: /Practice Quantity Controls/ }).click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  const head = grid.locator('[role="columnheader"][col-id="sequence"]');
  await head.locator(".ag-header-cell-text").click();
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  await head.locator(".ag-header-cell-text").click();
  await expect(head).toHaveAttribute("aria-sort", "descending");
  const actor = grid.locator('[role="columnheader"][col-id="actor"]');
  await actor.hover();
  await actor.locator(".ag-header-cell-filter-button").click();
  await page.locator(".ag-filter-body input").first().fill("no-such-actor");
  await page.keyboard.press("Escape");
  await expect(grid.locator(".ag-center-cols-container .ag-row")).toHaveCount(0);
  const source = page.getByLabel("Evidence source");
  await source.selectOption({ index: 1 });
  const search = page.getByLabel("Search events and IDs");
  await search.fill("no-such-event");
  const citation = page.locator(".citation-button").first();
  const target = await citation.getAttribute("title");
  expect(target).toBeTruthy();
  await citation.press("Enter");
  await expect(search).toHaveValue("");
  await expect(source).toHaveValue("all");
  await expect(page.getByLabel("Persisted event JSON")).toContainText(target!);
  await expect(grid.locator('.ag-row[row-id="' + target + '"]').first()).toHaveAttribute("row-id", target!);
  const horizontal = page.locator(".ag-body-horizontal-scroll-viewport");
  await horizontal.evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await expect(grid.getByRole("columnheader", { name: /Parent event ID/i })).toBeVisible();
});

test("demo scenarios, section links and both workspace destinations", async ({ page }) => {
  await page.route("**/api/demo?scenario=quantity", route => route.fulfill({
    status: 503, json: { error: "Archive temporarily unavailable" },
  }));
  await page.goto("/demo");
  await expect(page.locator("main [role=alert]")).toBeVisible();
  await page.unroute("**/api/demo?scenario=quantity");
  const retry = page.waitForResponse(r => r.url().endsWith("scenario=quantity"));
  await page.getByRole("button", { name: "Retry scenario" }).click();
  expect((await retry).ok()).toBe(true);
  await expect(page.locator("main [role=alert]")).toHaveCount(0);
  for (const [label, id] of [
    ["Authorized Sandbox Purchase", "authorized"], ["AI Quantity Deviation", "quantity"],
    ["Synthetic Policy Violation", "violation"], ["Practice Quantity Controls", "practice"],
  ]) {
    const response = page.waitForResponse(r => r.url().endsWith("scenario=" + id));
    const button = page.getByRole("button", { name: new RegExp(label) });
    await button.click();
    expect((await response).ok()).toBe(true);
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  const steps = page.getByRole("navigation", { name: "Guided story" });
  await expect(steps).toBeVisible();
  for (const link of await steps.getByRole("link").all()) {
    await link.click();
    expect(new URL(page.url()).hash).toBe(await link.getAttribute("href"));
  }
  await page.locator('main a[href="/shopping"]').click();
  await expect(page).toHaveURL(/\/shopping$/);
  await page.goto("/demo");
  await page.locator('main a[href="/"]').click();
  await expect(page).toHaveURL(/\/$/);
});

test("shopping result disclosures and outbound product reference use an explicitly mocked catalog source", async ({ page, context, request }) => {
  const fixture = await (await request.post("/api/firewall/scenarios", { data: { scenario: "allowed" } })).json();
  const run = fixture.run.run_id;
  const result = await (await request.get("/api/shopping/" + run)).json();
  const product = result.execution.recommendations[0].product;
  product.source = "channel3";
  product.source_reference = "https://catalog.example.invalid/fixture-offer";
  await page.route("**/api/shopping/" + run, route => route.fulfill({ json: result }));
  await context.route(product.source_reference, route => route.fulfill({ contentType: "text/plain", body: "Mock catalog source" }));
  await page.goto("/shopping?run=" + run);
  await activateDisclosure(page, /Mandate, policy version/i);
  await activateDisclosure(page, /Decision, rules and immutable references/i);
  const summary = page.locator("summary").filter({ hasText: /Product evidence.*source/i });
  await summary.click();
  const link = summary.locator("..").getByRole("link");
  await expect(link).toHaveAttribute("href", product.source_reference);
  const opened = page.waitForEvent("popup");
  await link.click();
  const productPage = await opened;
  await expect(productPage.locator("body")).toContainText("Mock catalog source");
  await productPage.close();
});
