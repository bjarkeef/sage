import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ToastProvider, useToast, type ToastOptions } from "./toast";

function Trigger(opts: ToastOptions) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(opts)} type="button">
      fire
    </button>
  );
}

function setup(opts: ToastOptions) {
  return render(
    <ToastProvider>
      <Trigger {...opts} />
    </ToastProvider>,
  );
}

const fire = () => fireEvent.click(screen.getByRole("button", { name: "fire" }));

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the live region mounted before any toast exists", () => {
    // Assistive tech only announces content inserted into a live region that
    // was ALREADY in the accessibility tree. Mounting the region together with
    // the first toast is the classic silent-toast bug: the screen reader sees
    // a new region rather than new content inside a known one.
    render(
      <ToastProvider>
        <span>quiet</span>
      </ToastProvider>,
    );
    expect(screen.getByTestId("toast-viewport")).toBeInTheDocument();
  });

  it("shows a message and dismisses it on its own", () => {
    setup({ title: "Transaction added" });
    fire();
    expect(screen.getByText("Transaction added")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.queryByText("Transaction added")).not.toBeInTheDocument();
  });

  it("shows the description under the title", () => {
    setup({ title: "Transaction added", description: "10 AAPL at $150.00" });
    fire();
    expect(screen.getByText("10 AAPL at $150.00")).toBeInTheDocument();
  });

  it("announces a confirmation politely and an error assertively", () => {
    const { unmount } = setup({ title: "Saved" });
    fire();
    expect(screen.getByText("Saved").closest("[role]")).toHaveAttribute("role", "status");
    unmount();

    setup({ title: "Nope", tone: "error" });
    fire();
    expect(screen.getByText("Nope").closest("[role]")).toHaveAttribute("role", "alert");
  });

  it("holds an error open longer than a confirmation", () => {
    // A confirmation can slide past unread at no cost; a failure the user has
    // to act on must not vanish while they are still reading it.
    setup({ title: "Nope", tone: "error" });
    fire();
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByText("Nope")).toBeInTheDocument();
  });

  it("can be dismissed by hand", () => {
    setup({ title: "Transaction added" });
    fire();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByText("Transaction added")).not.toBeInTheDocument();
  });

  it("fades out rather than blinking away", () => {
    // Unmounting on the spot is what makes a toast "pop" — it has to stay
    // mounted through its exit animation to be seen leaving at all.
    setup({ title: "Transaction added" });
    fire();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    const row = screen.getByText("Transaction added").closest("[role]");
    expect(row).toBeInTheDocument();
    expect(row?.className).toContain("fade-out-down");
    // ...and it must not linger as an invisible row holding a slot.
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.queryByText("Transaction added")).not.toBeInTheDocument();
  });

  it("ignores a second dismiss instead of extending the exit", () => {
    setup({ title: "Transaction added" });
    fire();
    const close = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(close);
    act(() => void vi.advanceTimersByTime(100));
    fireEvent.click(close);
    // Restarting the timer here would keep a half-faded toast on screen.
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.queryByText("Transaction added")).not.toBeInTheDocument();
  });

  it("keeps only the most recent few messages", () => {
    function Many() {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            for (const title of ["first", "second", "third", "fourth"]) toast({ title });
          }}
        >
          fire
        </button>
      );
    }
    render(
      <ToastProvider>
        <Many />
      </ToastProvider>,
    );
    fire();
    // The oldest drops off rather than growing a wall read backwards.
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    for (const title of ["second", "third", "fourth"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("throws a useful error when used outside the provider", () => {
    function Orphan() {
      useToast();
      return null;
    }
    // React logs the thrown error too; silence it so the run stays readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
