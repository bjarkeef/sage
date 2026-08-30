import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { API_URL } from "../config";

/**
 * Register a throwaway account and land signed in.
 *
 * A fresh account per spec, rather than a shared fixture user: the portfolio is
 * the unit of isolation in Sage, so a new account is an empty portfolio, and
 * specs cannot see each other's holdings however they are ordered.
 *
 * The credentials are generated here and thrown away — they exist only in a
 * disposable local database.
 */
export async function signUpFreshUser(page: Page): Promise<{ email: string }> {
  const email = `e2e-${randomUUID()}@sage.local`;
  const password = `E2e-${randomUUID()}`;

  await page.goto("/sign-up");

  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign up|create/i }).click();

  // Signed in = off the auth pages.
  await expect(page).not.toHaveURL(/\/sign-(up|in)/, { timeout: 30_000 });
  return { email };
}

/**
 * Create a custom holding and return its ticker.
 *
 * Custom holdings are the only instruments that need no market-data provider,
 * which keeps this suite off the network: a smoke test that fails because
 * Yahoo rate-limited a CI runner teaches nobody anything.
 */
export async function createCustomHolding(page: Page): Promise<string> {
  // Uppercase and unique: tickers are the instrument primary key, shared across
  // accounts, so a fixed one would collide between runs.
  const ticker = `E2E${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

  await page.goto("/custom-holding/new");
  await page.getByLabel("Ticker").fill(ticker);
  await page.getByLabel("Name").fill("E2E Test Holding");
  await page.getByLabel("Currency").fill("DKK");
  await page.getByRole("button", { name: /create holding/i }).click();

  await expect(page).not.toHaveURL(/custom-holding\/new/, { timeout: 30_000 });
  return ticker;
}

/**
 * Set the account's display currency.
 *
 * Load-bearing, not decoration. A position DTO reports a *display* currency
 * that only differs from the ledger's once a display currency is set and FX can
 * convert it. With them equal, a caller that confuses the two looks correct —
 * which is exactly why 1,458 unit tests and the first draft of this suite both
 * missed the holdings-row currency bug. A DKK holding viewed in USD is the
 * cheapest way to make the two differ.
 *
 * Driven through the API rather than the Settings UI: this is a precondition
 * for the journey under test, not part of it, and a settings-page redesign
 * should not break a transaction test.
 */
export async function setDisplayCurrency(page: Page, currency: string): Promise<void> {
  const res = await page.request.patch(`${API_URL}/user/settings`, {
    data: { displayCurrency: currency },
  });
  expect(res.ok(), `setting display currency to ${currency} failed`).toBe(true);
}

/** Fill and submit the transaction dialog, which is already open and locked to
 *  an instrument. */
export async function submitTransaction(
  page: Page,
  fields: { quantity: string; price: string },
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Quantity").fill(fields.quantity);
  await dialog.getByLabel("Price / share").fill(fields.price);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
}
