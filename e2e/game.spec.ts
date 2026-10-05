import { expect, test, type Browser, type Page } from "@playwright/test";

async function join(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId("join-code").fill("TEST");
  await page.getByTestId("join-name").fill(name);
  await page.getByTestId("join-submit").click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function hostPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/admin");
  await page.getByTestId("host-password").fill("test-host");
  await page.getByTestId("host-login").click();
  await page.getByRole("button", { name: "New question" }).click();
  await page.getByTestId("admin-prompt").fill("Name a fruit");
  await page.getByTestId("admin-answer-text-0").fill("Apple");
  await page.getByTestId("admin-answer-points-0").fill("25");
  await page.getByTestId("admin-answer-text-1").fill("Banana");
  await page.getByTestId("admin-answer-points-1").fill("15");
  await page.getByTestId("admin-save").click();
  await expect(page.getByText("Name a fruit")).toBeVisible();
  await page.goto("/host");
  return { context, page };
}

test("host, two players, and the display play a round", async ({ browser }) => {
  const host = await hostPage(browser);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const displayContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const display = await displayContext.newPage();

  await join(alice, "Alice");
  await join(bob, "Bob");

  await expect(host.page.getByTestId("player-Alice")).toBeVisible();
  await expect(host.page.getByTestId("player-Bob")).toBeVisible();
  await host.page.getByTestId("assign-Alice").selectOption({ label: "Family 1" });
  await host.page.getByTestId("assign-Bob").selectOption({ label: "Family 2" });
  await host.page.getByTestId("question-select").selectOption({ label: "Name a fruit" });
  await host.page.getByTestId("faceoff-1").selectOption({ label: "Alice" });
  await host.page.getByTestId("faceoff-2").selectOption({ label: "Bob" });
  await host.page.getByTestId("start-faceoff").click();

  await expect(alice.getByTestId("buzz")).toBeEnabled();
  await alice.getByTestId("buzz").click();
  await expect(alice.getByTestId("answer-input")).toBeVisible();
  await alice.getByTestId("answer-input").fill("apple");
  await alice.getByTestId("answer-submit").click();

  await expect(host.page.getByTestId("pending-text")).toContainText(/apple/i);
  await host.page.getByTestId("accept-answer").click();
  await expect(host.page.getByTestId("board-row-1")).toContainText("Apple");

  await display.goto("/display");
  await display.getByTestId("display-code").fill("TEST");
  await display.getByTestId("display-join").click();
  await expect(display.getByTestId("board-row-1")).toContainText("Apple");
  await expect(display.getByTestId("board-row-2")).not.toContainText("Banana");

  await host.page.getByTestId("choice-play").click();
  await host.page.getByTestId("host-answer").fill("banana");
  await host.page.getByTestId("host-answer-submit").click();
  await host.page.getByTestId("accept-answer").click();

  await expect(host.page.getByTestId("team-score-1")).toHaveText("40");
  await expect(display.getByTestId("board-row-2")).toContainText("Banana");
  await expect(display.getByTestId("team-score-1")).toHaveText("40");

  await host.context.close();
  await aliceContext.close();
  await bobContext.close();
  await displayContext.close();
});
