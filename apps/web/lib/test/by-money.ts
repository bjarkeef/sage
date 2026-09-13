import { screen } from "@testing-library/react";

/**
 * Find a money figure that is composed from several elements.
 *
 * The overview's hero sets the currency code and the øre at their own sizes, so
 * "$4,550.00" stopped being one text node and `getByText` could no longer see
 * it. Matching on whole-element text would then match every ancestor as well,
 * which would quietly break the one assertion that matters most here — the
 * guard that the portfolio's value is printed *once*, not once per component
 * that happens to know it.
 *
 * So: match elements whose entire text is the figure, then keep only the
 * innermost of them. A figure counts exactly once however many spans it is
 * built from.
 */
export function allByMoney(text: string): HTMLElement[] {
  const want = text.replace(/\s+/g, "");
  return screen.queryAllByText((_content, el) => {
    if (!el) return false;
    if ((el.textContent ?? "").replace(/\s+/g, "") !== want) return false;
    return !Array.from(el.children).some(
      (child) => (child.textContent ?? "").replace(/\s+/g, "") === want,
    );
  });
}

/** The single element showing `text`; throws when there is not exactly one. */
export function getByMoney(text: string): HTMLElement {
  const found = allByMoney(text);
  if (found.length !== 1) {
    throw new Error(`expected exactly one element showing ${text}, found ${found.length}`);
  }
  return found[0]!;
}
