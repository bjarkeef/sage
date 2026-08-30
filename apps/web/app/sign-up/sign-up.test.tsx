import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithClient } from "../../lib/test/render-with-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../../lib/api", () => ({
  getPublicConfig: vi.fn(),
}));
vi.mock("../../lib/auth-client", () => ({
  authClient: { signUp: { email: vi.fn() } },
}));

import SignUpPage from "./page";
import * as api from "../../lib/api";
import { authClient } from "../../lib/auth-client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getPublicConfig).mockResolvedValue({
    allowSignup: true,
    hasAccounts: true,
    mode: "open",
  });
  vi.mocked(authClient.signUp.email).mockResolvedValue({ error: null });
});

describe("SignUpPage", () => {
  it("names its inputs with real labels", async () => {
    renderWithClient(<SignUpPage />);
    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("states the password minimum before it is rejected, not after", async () => {
    renderWithClient(<SignUpPage />);
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute("minLength", "8");
  });

  it("registers with what was typed", async () => {
    renderWithClient(<SignUpPage />);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@b.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "longenough1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    await waitFor(() =>
      expect(authClient.signUp.email).toHaveBeenCalledWith({
        name: "Ada",
        email: "ada@b.test",
        password: "longenough1",
      }),
    );
  });

  it("reports a rejected sign-up as an alert", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      error: { message: "Email already in use." },
    });
    renderWithClient(<SignUpPage />);
    // Required fields: jsdom enforces constraint validation, so an empty
    // submit never reaches the handler.
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@b.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "longenough1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email already in use.");
  });

  it("warns that the password cannot be recovered by email", async () => {
    renderWithClient(<SignUpPage />);
    expect(await screen.findByText(/no email password reset/i)).toBeInTheDocument();
  });

  it("explains a locked-down instance instead of showing a dead form", async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({
      allowSignup: false,
      hasAccounts: true,
      mode: "invite_only",
    });
    renderWithClient(<SignUpPage />);
    expect(await screen.findByText("Registration closed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByText(/ALLOW_SIGNUP=true/)).toBeInTheDocument();
  });
});
