import type { ReactElement } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderWithClient, makeTestQueryClient } from "@/lib/test/render-with-client";

const {
  getUserSettingsMock,
  patchOverviewPrefsMock,
  updateDividendTaxRateMock,
  updateAutoAddDividendsMock,
  updateAllowNegativeDividendGrowthMock,
} = vi.hoisted(() => ({
  getUserSettingsMock: vi.fn(),
  patchOverviewPrefsMock: vi.fn(),
  updateDividendTaxRateMock: vi.fn(),
  updateAutoAddDividendsMock: vi.fn(),
  updateAllowNegativeDividendGrowthMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getUserSettings: getUserSettingsMock,
  patchOverviewPrefs: patchOverviewPrefsMock,
  updateDividendTaxRate: updateDividendTaxRateMock,
  updateAutoAddDividends: updateAutoAddDividendsMock,
  updateAllowNegativeDividendGrowth: updateAllowNegativeDividendGrowthMock,
  deleteAllHoldings: vi.fn().mockResolvedValue(undefined),
  // The System card fetches instance status; this suite is about the sections
  // above it, so keep it resolved rather than left in flight.
  getSystemStatus: vi.fn().mockResolvedValue({
    environment: {
      nodeEnv: "test",
      nodeVersion: "v22.14.0",
      uptimeSeconds: 1,
      signups: "open",
      schemaMigrations: 1,
    },
    providers: {
      marketData: "yahoo",
      enrichment: "none",
      keys: { eodhd: false },
      health: [],
      pricesAgeSeconds: null,
      pricesStale: false,
      pricesMissing: 0,
    },
    fx: { displayCurrency: null, ratesAsOf: null, coverageFrom: null, pairs: [] },
  }),
}));

import SettingsPage from "./page";
import type { UserSettingsDTO } from "@/lib/types";

function render(ui: ReactElement) {
  return renderWithClient(ui, makeTestQueryClient());
}

function settings(
  overrides: Partial<UserSettingsDTO["overviewPrefs"]> = {},
  dividendTaxRate: number | null = null,
): UserSettingsDTO {
  return {
    displayCurrency: null,
    overviewPrefs: {
      brief: true,
      paydayGreeting: true,
      marketState: true,
      incomeRoom: true,
      portfolioRoom: true,
      statStrip: false,
      performanceCard: true,
      incomeCard: true,
      portfolioCard: true,
      upcomingCard: true,
      ...overrides,
    },
    dividendTaxRate,
    autoAddDividends: true,
    allowNegativeDividendGrowth: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserSettingsMock.mockResolvedValue(settings());
  patchOverviewPrefsMock.mockResolvedValue(undefined);
  updateDividendTaxRateMock.mockResolvedValue(undefined);
  updateAutoAddDividendsMock.mockResolvedValue(undefined);
  updateAllowNegativeDividendGrowthMock.mockResolvedValue(undefined);
});

describe("SettingsPage — Overview section", () => {
  it("renders eight toggle rows reflecting the loaded prefs", async () => {
    render(<SettingsPage />);

    expect(await screen.findByText("Morning brief")).toBeInTheDocument();
    expect(screen.getByText("Payday greetings")).toBeInTheDocument();
    expect(screen.getByText("Market status")).toBeInTheDocument();
    expect(screen.getByText("Stat strip")).toBeInTheDocument();
    expect(screen.getByText("Performance card")).toBeInTheDocument();
    expect(screen.getByText("Income card")).toBeInTheDocument();
    expect(screen.getByText("Portfolio card")).toBeInTheDocument();
    expect(screen.getByText("Upcoming card")).toBeInTheDocument();

    // 8 overview rows + "Add dividends automatically" + "Allow negative dividend growth", both in the Dividends section.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(10);
    // The settings query resolves a tick after the static labels render — wait
    // for the load-driven enable before asserting on disabled/checked state.
    await waitFor(() => expect(switches[0]).not.toBeDisabled());
    // brief, paydayGreeting, marketState, statStrip, performanceCard, incomeCard, portfolioCard, upcomingCard, autoAdd, allowNegativeGrowth
    const statStripSwitch = switches[3]!; // defaults off
    expect(statStripSwitch).toHaveAttribute("data-state", "unchecked");
    for (const s of switches) {
      if (s === statStripSwitch) continue;
      expect(s).toHaveAttribute("data-state", "checked");
    }
    for (const s of switches) {
      expect(s).not.toBeDisabled();
    }
  });

  it("renders the stat-strip and card toggles and PATCHes the right key", async () => {
    render(<SettingsPage />);
    const stripSwitch = await screen.findByRole("switch", { name: /stat strip/i });
    await waitFor(() => expect(stripSwitch).not.toBeDisabled());
    expect(stripSwitch).toHaveAttribute("data-state", "unchecked"); // off by default
    fireEvent.click(stripSwitch);
    await waitFor(() => expect(patchOverviewPrefsMock).toHaveBeenCalledWith({ statStrip: true }));
  });

  it("disables switches until prefs have loaded", () => {
    getUserSettingsMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SettingsPage />);
    const switches = screen.getAllByRole("switch");
    for (const s of switches) {
      expect(s).toBeDisabled();
    }
  });

  it("clicking a switch calls patchOverviewPrefs with only the changed key, flips optimistically, and invalidates the settings cache", async () => {
    const qc = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithClient(<SettingsPage />, qc);
    await screen.findByText("Market status");

    const switches = screen.getAllByRole("switch");
    const marketSwitch = switches[2]!; // brief, paydayGreeting, marketState, ...
    expect(marketSwitch).toHaveAttribute("data-state", "checked");
    await waitFor(() => expect(marketSwitch).not.toBeDisabled());

    fireEvent.click(marketSwitch);

    expect(marketSwitch).toHaveAttribute("data-state", "unchecked");
    await waitFor(() =>
      expect(patchOverviewPrefsMock).toHaveBeenCalledWith({ marketState: false }),
    );
    expect(patchOverviewPrefsMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["user-settings"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("reverts the switch when the PATCH fails", async () => {
    patchOverviewPrefsMock.mockRejectedValueOnce(new Error("fail"));
    render(<SettingsPage />);
    await screen.findByText("Market status");

    const switches = screen.getAllByRole("switch");
    const marketSwitch = switches[2]!;
    expect(marketSwitch).toHaveAttribute("data-state", "checked");
    await waitFor(() => expect(marketSwitch).not.toBeDisabled());

    fireEvent.click(marketSwitch);
    expect(marketSwitch).toHaveAttribute("data-state", "unchecked");

    await waitFor(() => expect(marketSwitch).toHaveAttribute("data-state", "checked"));
  });

  it("reverts only the failed key when two toggles race and one rejects", async () => {
    function deferred() {
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = () => res();
        reject = (e) => rej(e);
      });
      return { promise, resolve, reject };
    }

    const first = deferred(); // marketState — will reject
    const second = deferred(); // performanceCard — will resolve
    patchOverviewPrefsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<SettingsPage />);
    await screen.findByText("Market status");

    const switches = screen.getAllByRole("switch");
    const marketSwitch = switches[2]!; // key A
    const performanceSwitch = switches[4]!; // key B
    await waitFor(() => expect(marketSwitch).not.toBeDisabled());

    // Both flipped off before either request settles.
    fireEvent.click(marketSwitch);
    fireEvent.click(performanceSwitch);
    expect(marketSwitch).toHaveAttribute("data-state", "unchecked");
    expect(performanceSwitch).toHaveAttribute("data-state", "unchecked");

    expect(patchOverviewPrefsMock).toHaveBeenNthCalledWith(1, { marketState: false });
    expect(patchOverviewPrefsMock).toHaveBeenNthCalledWith(2, { performanceCard: false });

    // First (marketState) fails, second (performanceCard) succeeds.
    second.resolve();
    first.reject(new Error("fail"));

    // marketState reverts to its original ON state; performanceCard stays flipped OFF.
    await waitFor(() => expect(marketSwitch).toHaveAttribute("data-state", "checked"));
    expect(performanceSwitch).toHaveAttribute("data-state", "unchecked");
  });
});

describe("SettingsPage — Dividend tax rate", () => {
  it("shows an empty input when no tax rate is set", async () => {
    render(<SettingsPage />);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);
    expect(input.value).toBe("");
  });

  it("pre-fills the input with the loaded tax rate", async () => {
    getUserSettingsMock.mockResolvedValue(settings({}, 27));
    render(<SettingsPage />);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);
    await waitFor(() => expect(input.value).toBe("27"));
  });

  it("commits a typed value on blur, calling updateDividendTaxRate and invalidating settings + dividend income", async () => {
    const qc = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithClient(<SettingsPage />, qc);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);
    // Wait for the settings-sync effect to settle before typing, otherwise it
    // can land after the edit and clobber it back to the loaded (empty) value.
    await waitFor(() => expect(input.value).toBe(""));

    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateDividendTaxRateMock).toHaveBeenCalledWith(35));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dividend-income"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["user-settings"] });
  });

  it("clears the rate back to null when the input is emptied", async () => {
    getUserSettingsMock.mockResolvedValue(settings({}, 27));
    render(<SettingsPage />);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);
    await waitFor(() => expect(input.value).toBe("27"));

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateDividendTaxRateMock).toHaveBeenCalledWith(null));
  });

  it("reverts the input when the save fails", async () => {
    getUserSettingsMock.mockResolvedValue(settings({}, 10));
    updateDividendTaxRateMock.mockRejectedValueOnce(new Error("fail"));
    render(<SettingsPage />);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);
    await waitFor(() => expect(input.value).toBe("10"));

    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input.value).toBe("10"));
  });

  it("rejects an out-of-range value without saving", async () => {
    render(<SettingsPage />);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);

    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.blur(input);

    expect(updateDividendTaxRateMock).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("does not clobber an in-flight (un-blurred) tax-rate edit when an Overview switch refetches settings", async () => {
    // The initial load and the invalidation-triggered refetch must resolve with
    // DISTINCT object references whose content actually differs (mirroring what
    // the real API would return once the toggle's PATCH has landed server-side).
    // If both resolutions were the same settings() reference, react-query's
    // `data` identity would never change, the sync effect would never re-fire,
    // and this test would pass even against the pre-fix (unconditional-sync) code.
    getUserSettingsMock.mockResolvedValueOnce({ ...settings() }).mockResolvedValueOnce({
      ...settings(),
      overviewPrefs: { ...settings().overviewPrefs, marketState: false },
    });

    render(<SettingsPage />);
    const input = await screen.findByLabelText<HTMLInputElement>(/dividend tax rate/i);
    await waitFor(() => expect(input.value).toBe(""));

    // Type a new value but do NOT blur — this is the in-flight edit that must survive.
    fireEvent.change(input, { target: { value: "42" } });
    expect(input.value).toBe("42");

    const switches = screen.getAllByRole("switch");
    const marketSwitch = switches[2]!;
    await waitFor(() => expect(marketSwitch).not.toBeDisabled());
    fireEvent.click(marketSwitch);

    await waitFor(() =>
      expect(patchOverviewPrefsMock).toHaveBeenCalledWith({ marketState: false }),
    );
    // Wait for the settings-invalidation refetch (triggered by the toggle) to
    // actually land, i.e. getUserSettings has been called again beyond the
    // initial mount fetch — this is the refetch that used to re-sync local
    // state and wipe out the un-blurred edit.
    await waitFor(() => expect(getUserSettingsMock.mock.calls.length).toBeGreaterThan(1));

    expect(input.value).toBe("42");
  });
});

describe("SettingsPage — Automatic dividends", () => {
  it("toggles auto-added dividends and PATCHes the setting", async () => {
    render(<SettingsPage />);
    const toggle = await screen.findByRole("switch", { name: /add dividends automatically/i });
    expect(toggle).toBeChecked();
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(updateAutoAddDividendsMock).toHaveBeenCalledWith(false));
  });

  it("reverts the toggle when the PATCH fails", async () => {
    updateAutoAddDividendsMock.mockRejectedValueOnce(new Error("fail"));
    render(<SettingsPage />);
    const toggle = await screen.findByRole("switch", { name: /add dividends automatically/i });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(updateAutoAddDividendsMock).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toBeChecked()); // reverted
  });
});

describe("SettingsPage — Allow negative dividend growth", () => {
  it("reflects the loaded setting and PATCHes on toggle", async () => {
    getUserSettingsMock.mockResolvedValue({ ...settings(), allowNegativeDividendGrowth: true });
    render(<SettingsPage />);
    const toggle = await screen.findByRole("switch", { name: "Allow negative dividend growth" });
    expect(toggle).toBeChecked();
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(updateAllowNegativeDividendGrowthMock).toHaveBeenCalledWith(false));
  });

  it("reverts the toggle when the PATCH fails", async () => {
    updateAllowNegativeDividendGrowthMock.mockRejectedValueOnce(new Error("fail"));
    render(<SettingsPage />);
    const toggle = await screen.findByRole("switch", { name: "Allow negative dividend growth" });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(updateAllowNegativeDividendGrowthMock).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toBeChecked()); // reverted
  });
});

describe("SettingsPage — Danger zone", () => {
  it("invalidates the portfolio-wide query families after a successful delete-all", async () => {
    const qc = makeTestQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderWithClient(<SettingsPage />, qc);
    await screen.findByText("Delete all holdings");

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Deleted" })).toBeDisabled());

    for (const key of [
      "dashboard",
      "portfolio",
      "performance",
      "dividend-income",
      "diversification",
      "transactions",
      "asset-detail",
    ]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});

describe("SettingsPage — Disclaimer", () => {
  // Deliberately one line, not the full statement — the README carries that.
  // What the app owes a reader is the caveat attached to a figure while they
  // are looking at it, which is the goal page's job rather than this page's.
  it("says the app does not advise, and points at the full statement", async () => {
    render(<SettingsPage />);

    const line = await screen.findByText(/Sage records and measures; it does not advise/i);
    expect(line).toHaveTextContent(/not financial, investment, tax, or legal advice/i);
    expect(line).toHaveTextContent(/see the README for the full statement/i);
  });
});
