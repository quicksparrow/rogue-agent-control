import { test, expect } from "@playwright/test";

test("owner can create a new immutable policy version without altering the selected historical version", async ({
  page,
  request,
}) => {
  await page.goto("/firewall");
  await expect(
    page.getByRole("heading", { name: "Policy Firewall.", exact: true }),
  ).toBeVisible();
  const selected = await page.getByLabel("Version to revise").inputValue();
  const before = await (await request.get("/api/policies")).json();
  const old = before.policies.find(
    (p: { version: string }) => p.version === selected,
  );
  await page.getByLabel("Policy label").fill("Browser verified owner version");
  await page
    .getByRole("button", { name: "Save new policy version", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved revision" }),
  ).toBeVisible();
  const after = await (await request.get("/api/policies")).json();
  expect(
    after.policies.find((p: { version: string }) => p.version === selected),
  ).toEqual(old);
  expect(await page.getByLabel("Version to revise").inputValue()).not.toBe(
    selected,
  );
  await page.goto("/shopping");
  await expect(page.getByLabel("Owner policy version")).toBeVisible();
  await expect(page.getByLabel("Owner policy version")).not.toHaveValue("");
});

test("five labeled scenarios display actual deterministic decisions and preserve blocked/review states", async ({
  page,
}) => {
  await page.goto("/firewall");
  for (const [letter, expected] of [
    ["A", "ALLOW"],
    ["B", "DENY"],
    ["C", "REVIEW"],
    ["D", "DENY"],
    ["E", "REVIEW"],
  ]) {
    await page
      .getByRole("button", { name: `Evaluate ${letter}`, exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "payment executed: false" }),
    ).toContainText(expected);
  }
  await page
    .getByRole("link", { name: "Inspect fixture in Black Box", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Controlled policy fixture",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Policy decision: REVIEW" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /Inspect event \d+: Policy Firewall decision/,
    })
    .click();
  await expect(
    page
      .getByTestId("evidence-inspector")
      .getByRole("heading", { name: "Policy Firewall decision", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Inspect event \d+: Local model invoked/,
    }),
  ).toHaveCount(0);
});

test("client ALLOW/approval spoofing and direct payment/approval bypass routes cannot execute", async ({
  request,
}) => {
  const response = await request.post("/api/firewall/scenarios", {
    data: { scenario: "over_budget" },
  });
  const result = await response.json();
  for (const extra of [
    { outcome: "ALLOW" },
    { approved: true },
    { policy_version: "forged" },
    { max_total_minor: 99999999 },
  ]) {
    expect(
      (
        await request.post("/api/gateway/authorize", {
          data: { proposal_id: result.proposal.proposal_id, ...extra },
        })
      ).status(),
    ).toBe(400);
  }
  const authorized = await (
    await request.post("/api/gateway/authorize", {
      data: { proposal_id: result.proposal.proposal_id },
    })
  ).json();
  expect(authorized.decision.outcome).toBe("DENY");
  expect(authorized.payment_executed).toBe(false);
  for (const endpoint of [
    "/api/gateway/execute",
    "/api/payments/create",
    "/api/firewall/approve",
  ])
    expect(
      (
        await request.post(endpoint, {
          data: {
            proposal_id: result.proposal.proposal_id,
            outcome: "ALLOW",
            approved: true,
          },
        })
      ).status(),
    ).toBe(404);
});

test("Firewall controls and decision evidence fit a narrow viewport with keyboard-accessible inputs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/firewall");
  await expect(page.getByLabel("Policy label")).not.toHaveValue("");
  await page.getByRole("button", { name: "Evaluate C", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "payment executed: false" }),
  ).toContainText("REVIEW");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Inspect fixture in Black Box", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Policy decision: REVIEW" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
