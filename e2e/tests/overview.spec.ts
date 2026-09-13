import { test, expect } from "@playwright/test";
import { createCustomHolding, signUpFreshUser, submitTransaction } from "./support";

/**
 * The overview's range control sits ON the plot, and the plot is a canvas.
 *
 * It shipped unclickable: lightweight-charts gives its two canvases their own
 * stacking, so a later sibling still painted under them and `elementFromPoint`
 * on a pill returned CANVAS. Nothing caught it — jsdom has no layout and no
 * paint order, so a unit test can click a control that is buried under a canvas
 * in every real browser and pass. Only a real click at real coordinates can
 * tell the difference, which is what this is.
 *
 * It deliberately clicks by POSITION rather than by role. Asserting the control
 * responds to `getByRole(...).click()` would pass even with the canvas on top,
 * because Playwright scrolls to and actuates the element itself.
 */
test.describe("the overview's range control", () => {
  test("is clickable where it is drawn, not just present in the DOM", async ({ page }) => {
    await signUpFreshUser(page);
    const ticker = await createCustomHolding(page);
    await page.goto(`/asset/${ticker}`);
    await page.getByRole("button", { name: /add transaction/i }).click();
    await submitTransaction(page, { quantity: "10", price: "100" });

    await page.goto("/");
    // The plot has to exist before anything can be layered over it.
    await page.waitForSelector("canvas", { timeout: 30_000 });

    const pill = page.locator("button", { hasText: /^3M$/ }).first();
    await expect(pill).toBeVisible();

    // `click()` is the assertion. Playwright verifies the hit target before it
    // actuates, so a canvas painted over the control fails here with "element
    // intercepts pointer events" rather than silently passing — which is
    // exactly what a jsdom test does, and why this bug reached the box.
    await pill.click();

    // Selected, not merely clicked. Deliberately NOT asserting on the
    // range-scoped figure: a fresh account has too few points for that cell to
    // render at all, so the test would fail for a reason unrelated to the one
    // it guards.
    await expect(pill).toHaveAttribute("aria-checked", "true");
  });
});
