import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient } from "../../lib/test/render-with-client";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
}));
vi.mock("../../lib/api", () => ({
  getPublicConfig: vi
    .fn()
    .mockResolvedValue({ allowSignup: true, hasAccounts: true, mode: "open" }),
}));
vi.mock("../../lib/auth-client", () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

import SignInPage from "./page";
import * as api from "../../lib/api";
import { authClient } from "../../lib/auth-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getPublicConfig).mockResolvedValue({
    allowSignup: true,
    hasAccounts: true,
    mode: "open",
  });
  vi.mocked(authClient.signIn.email).mockResolvedValue({ error: null });
});

describe("SignInPage", () => {
  /** `/` lands here, so on an instance nobody has claimed this page greeted the
   *  very first self-hoster with "Welcome back" and a sign-in form for an
   *  account that could not exist, with registration as a small link below. */
  it("sends the first visitor to sign-up when no account exists yet", async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({
      allowSignup: true,
      hasAccounts: false,
      mode: "open",
    });

    renderWithClient(<SignInPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-up"));
  });

  it("stays put once the instance has an account", async () => {
    renderWithClient(<SignInPage />);

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  /** A closed instance has an owner by definition, but if the flags ever
   *  disagree, bouncing someone to a registration page that refuses them is
   *  the worse failure. */
  it("does not redirect when signups are closed", async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({
      allowSignup: false,
      hasAccounts: false,
      mode: "invite_only",
    });

    renderWithClient(<SignInPage />);

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("names its inputs with real labels", async () => {
    // The forms contract: these were placeholder-only, so the name vanished on
    // the first keystroke and never existed for a screen reader at all.
    renderWithClient(<SignInPage />);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("signs in with what was typed", async () => {
    renderWithClient(<SignInPage />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "a@b.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: "a@b.test",
        password: "hunter2hunter2",
      }),
    );
  });

  it("reports a rejected sign-in as an alert", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      error: { message: "Invalid email or password." },
    });
    renderWithClient(<SignInPage />);
    // Both fields are `required`, and jsdom enforces constraint validation on
    // submit — leaving them empty blocks the handler and tests nothing.
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "a@b.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpassword" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("says how recovery works, because there is no email reset", async () => {
    // Sage ships no SMTP by design. Without this line a locked-out user has
    // nothing to try; with it they know to go to the operator.
    renderWithClient(<SignInPage />);
    expect(await screen.findByText(/no email reset/i)).toBeInTheDocument();
  });

  it("says registration is closed rather than silently dropping the link", async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({
      allowSignup: false,
      hasAccounts: true,
      mode: "invite_only",
    });
    renderWithClient(<SignInPage />);
    expect(await screen.findByText(/registration is closed/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign up" })).not.toBeInTheDocument();
  });

  it("offers sign-up when the instance is open", async () => {
    renderWithClient(<SignInPage />);
    expect(await screen.findByRole("link", { name: "Sign up" })).toBeInTheDocument();
  });
});
