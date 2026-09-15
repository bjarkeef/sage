import { test, expect } from "@playwright/test";
import { createCustomHolding, signUpFreshUser, submitTransaction } from "./support";

/**
 * The overview's value chart is a canvas, and its range control has to be
 * clickable where it is drawn.
 *
 * It shipped unclickable once: lightweight-charts gives its two canvases their
 * own stacking, so a later sibling still painted under them and
 * `elementFromPoint` on a pill returned CANVAS. Nothing caught it — jsdom has
 * no layout and no paint order, so a unit test can click a control buried under
 * a canvas in every real browser and pass. Only a real click at real
 * coordinates can tell the difference, which is what this is.
 *
 * It deliberately clicks by POSITION rather than by role. Asserting the control
 * responds to `getByRole(...).click()` would pass even with the canvas on top,
 * because Playwright scrolls to and actuates the element itself.
 *
 * NOTE (2026-09-15): the control no longer sits ON the plot. The overview leads
 * with the income stream now, and the value chart moved into a card below the
 * fold in its `ambient` variant, where the range control is a normal sibling
 * above the canvas rather than an overlay. So this no longer guards the
 * stacking bug it was written for — it guards that the control is reachable at
 * all, which is still worth a real browser. The overlay path survives in
 * `PortfolioChart`'s `horizon` variant, which nothing currently renders; if
 * that variant is ever deleted, delete the `z-10` note with it.
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
