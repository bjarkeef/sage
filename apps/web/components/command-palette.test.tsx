import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithClient } from "@/lib/test/render-with-client";
import type { PositionDTO } from "@/lib/types";
import { CommandPalette } from "./command-palette";
import { MediaPrefsProvider } from "./media-prefs-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }) }));
vi.mock("../lib/api", () => ({
  getPortfolio: vi.fn().mockResolvedValue({
    positions: [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        website: "https://www.apple.com",
        marketValue: null,
      } as unknown as PositionDTO,
    ],
  }),
  searchInstruments: vi.fn().mockResolvedValue([]),
  getUserSettings: vi.fn(() => new Promise(() => {})),
}));

describe("CommandPalette logos", () => {
  it("draws a holding's logo from logo.dev once the user turned logos on", async () => {
    renderWithClient(
      <MediaPrefsProvider
        initial={{ showCompanyLogos: true, showNewsThumbnails: false, logoDevToken: "pk_mine" }}
      >
        <CommandPalette />
      </MediaPrefsProvider>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    const img = await screen.findByRole("img", { name: "AAPL logo" });
    expect(img.getAttribute("src")).toMatch(/^https:\/\/img\.logo\.dev\/.*token=pk_mine/);
  });
});
