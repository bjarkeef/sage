import { test, expect } from "@playwright/test";
import {
  createCustomHolding,
  setDisplayCurrency,
  signUpFreshUser,
  submitTransaction,
} from "./support";

/**
 * The journey the unit suite cannot cover.
 *
 * On 2026-08-16 the holdings-row quick add was broken for every holding whose
 * ledger currency differed from the display currency, while 1,458 unit tests
 * passed — each component was correct in isolation and the DTO contract between
 * them was not. Only a real request through a real API against a real database
 * catches that class, which is what this file is for.
 */
test.describe("adding a transaction", () => {
  test("records a buy from the asset page and shows it in the holding's ledger", async ({
    page,
  }) => {
    await signUpFreshUser(page);
    const ticker = await createCustomHolding(page);

    await page.goto(`/asset/${ticker}`);
    await page.getByRole("button", { name: /add transaction/i }).click();
    await submitTransaction(page, { quantity: "10", price: "100" });

    // The confirmation names what was written, not just that something was.
    await expect(page.getByText("Transaction added")).toBeVisible();
    await expect(page.getByText(`Bought 10 ${ticker}`)).toBeVisible();

    // ...and the entry is readable where it was entered, so it can be undone.
    const section = page.locator("section", { hasText: "Transactions" }).last();
    await expect(
      section.getByRole("button", { name: new RegExp(`Delete buy of ${ticker}`) }),
    ).toBeVisible();
  });

  test("quick-adds from a holdings row when display currency differs from the ledger", async ({
    page,
  }) => {
    // The exact path that broke, reproduced under the only conditions that can
    // expose it. The holdings row posts using the position DTO's currency; when
    // that was the *display* currency rather than the ledger's, the API refused
    // the write and the user saw only "Could not save the transaction."
    //
    // The holding is kept in DKK and viewed in USD deliberately. With the two
    // equal — the default for a fresh account — the bug is invisible, and an
    // earlier draft of this very test passed with the defect reinstated.
    await signUpFreshUser(page);
    await setDisplayCurrency(page, "USD");
    const ticker = await createCustomHolding(page);

    // A holding needs a position before it appears as a row.
    await page.goto(`/asset/${ticker}`);
    await page.getByRole("button", { name: /add transaction/i }).click();
    await submitTransaction(page, { quantity: "10", price: "100" });
    await expect(page.getByText("Transaction added")).toBeVisible();

    await page.goto("/holdings");
    await expect(page.getByText(ticker).first()).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`Add transaction for ${ticker}`) }).click();
    await submitTransaction(page, { quantity: "5", price: "110" });

    await expect(page.getByText("Transaction added")).toBeVisible();
    await expect(page.getByText(`Bought 5 ${ticker}`)).toBeVisible();
    // A currency_mismatch surfaces here instead; assert it explicitly so a
    // regression names itself rather than timing out on the toast above.
    await expect(page.getByText(/bought and sold in/i)).toBeHidden();
  });

  test("deletes a transaction from the asset page", async ({ page }) => {
    await signUpFreshUser(page);
    const ticker = await createCustomHolding(page);

    await page.goto(`/asset/${ticker}`);
    await page.getByRole("button", { name: /add transaction/i }).click();
    await submitTransaction(page, { quantity: "10", price: "100" });
    await expect(page.getByText("Transaction added")).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`Delete buy of ${ticker}`) }).click();
    await expect(page.getByText("Transaction deleted")).toBeVisible();

    // Assert on the ledger, not on the toast text: the delete confirmation
    // itself reads "Bought 10 <ticker>" — it names what went — so waiting for
    // that phrase to disappear would be waiting for the confirmation to expire.
    await expect(
      page.getByRole("button", { name: new RegExp(`Delete buy of ${ticker}`) }),
    ).toBeHidden();
    await expect(page.getByText(`No transactions recorded for ${ticker}`)).toBeVisible();
  });
});
