import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldRow } from "./field";

describe("Field", () => {
  it("binds its label to the control so the control is reachable by name", () => {
    // The bug this guards: the transaction form named its inputs with
    // placeholders, which vanish on first keystroke and are not labels.
    render(
      <Field label="Quantity" htmlFor="qty">
        <input id="qty" />
      </Field>,
    );
    expect(screen.getByLabelText("Quantity")).toBeInTheDocument();
  });

  it("labels forms in sans, not the caps-mono eyebrow token", () => {
    // DESIGN.md: label-caps is for eyebrows over figures. Six stacked in one
    // dialog shout, and break the one-caps-per-region contract.
    render(
      <Field label="Price" htmlFor="price">
        <input id="price" />
      </Field>,
    );
    const label = screen.getByText("Price");
    expect(label.className).not.toContain("label-caps");
    expect(label.className).toContain("font-medium");
  });

  it("shows an error instead of the hint when both are present", () => {
    render(
      <Field label="Fee" htmlFor="fee" hint="Optional" error="Fee must be zero or positive.">
        <input id="fee" />
      </Field>,
    );
    expect(screen.getByText("Fee must be zero or positive.")).toBeInTheDocument();
    expect(screen.queryByText("Optional")).not.toBeInTheDocument();
  });

  it("shows the hint when there is no error", () => {
    render(
      <Field label="Fee" htmlFor="fee" hint="Optional">
        <input id="fee" />
      </Field>,
    );
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("degrades to a plain caption when there is no control to bind to", () => {
    // A locked identity row (or any control that isn't itself labelable) has
    // nothing an id could point at — a <label for> there would name nothing,
    // which is worse than an honest, unbound caption.
    render(
      <Field label="Holding">
        <div>AAPL</div>
      </Field>,
    );
    const caption = screen.getByText("Holding");
    expect(caption.tagName).toBe("SPAN");
    expect(caption).not.toHaveAttribute("for");
  });

  it("still labels a control for real when htmlFor is given", () => {
    render(
      <Field label="Quantity" htmlFor="qty2">
        <input id="qty2" />
      </Field>,
    );
    expect(screen.getByText("Quantity").tagName).toBe("LABEL");
  });

  it("mints an id on the caption so a composite control can reach it via aria-labelledby, without a decoy htmlFor", () => {
    // Regression this guards: a `role="radiogroup"` div can't be bound by
    // `<label for>` at all, so the caller used to pass `htmlFor` anyway just
    // to get an id minted for aria-labelledby — leaving a `<label for="...">`
    // that pointed at an id nothing rendered. `id` mints the caption's id
    // directly, with no dangling binding.
    render(
      <Field label="Goal" id="goal-mode">
        <div role="radiogroup" aria-labelledby="goal-mode-label">
          <div role="radio" aria-checked="true">
            Income
          </div>
        </div>
      </Field>,
    );
    const caption = screen.getByText("Goal");
    expect(caption.tagName).toBe("SPAN");
    expect(caption).toHaveAttribute("id", "goal-mode-label");
    expect(caption).not.toHaveAttribute("for");
    expect(screen.getByRole("radiogroup", { name: "Goal" })).toBeInTheDocument();
  });

  it("renders an action beside the label", () => {
    render(
      <Field
        label="Holding"
        htmlFor="h"
        action={<a href="/custom-holding/new">add a custom holding</a>}
      >
        <input id="h" />
      </Field>,
    );
    expect(screen.getByRole("link", { name: "add a custom holding" })).toBeInTheDocument();
  });
});

describe("FieldRow", () => {
  it("pairs children into two columns above the small breakpoint", () => {
    const { container } = render(
      <FieldRow>
        <div>a</div>
        <div>b</div>
      </FieldRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("sm:grid-cols-2");
  });
});
