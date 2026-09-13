import { describe, expect, it } from "vitest";
import { toBriefInput } from "./brief-input";
import type {
  AnnouncedDividendDTO,
  DashboardDTO,
  PortfolioHistoryPoint,
  PositionDTO,
  UpcomingRow,
} from "./types";
import type { OverviewPrefs } from "./types";

const ALL_ON: OverviewPrefs = {
  brief: true,
  paydayGreeting: true,
  marketState: true,
  incomeRoom: true,
  portfolioRoom: true,
  statStrip: false,
  goalBand: true,
  performanceCard: true,
  incomeCard: true,
  portfolioCard: true,
  upcomingCard: true,
};

function point(amount: string, currency = "USD"): PortfolioHistoryPoint {
  return {
    date: "2026-07-10",
    value: { amount, currency },
    invested: { amount, currency },
  };
}

function pos(symbol: string, dailyChangePercent: number | null): PositionDTO {
  return { symbol, dailyChangePercent } as PositionDTO;
}

function dividend(overrides: Partial<AnnouncedDividendDTO>): AnnouncedDividendDTO {
  return {
    symbol: "MPAY",
    name: "Mpay Monthly Income",
    declarationDate: null,
    exDate: "2026-07-10",
    recordDate: null,
    paymentDate: "2026-07-10",
    paymentDateEstimated: false,
    amountPerShare: "1",
    shares: "100",
    income: "100",
    currency: "USD",
    ...overrides,
  };
}

/** `dashboard.upcomingDividends` rows arrive pre-resolved to the date they'll
 *  display (the announced/exDate fallback now happens upstream, in the API's
 *  `selectUpcoming` — see apps/api/src/routes/dashboard.test.ts) so, unlike
 *  `dividend()` above, this factory takes `date` directly rather than
 *  `paymentDate`/`exDate`. */
function upcoming(overrides: Partial<UpcomingRow> & { symbol: string }): UpcomingRow {
  return {
    name: "Mpay Monthly Income",
    date: "2026-07-10",
    income: "100",
    currency: "USD",
    dateEstimated: false,
    projected: false,
    ...overrides,
  };
}

function dashboard(overrides: Partial<DashboardDTO> = {}): DashboardDTO {
  return {
    displayCurrency: "USD",
    positions: [],
    subtotalsByCurrency: [],
    todayChange: null,
    totalReturn: null,
    ytdTwr: null,
    ytdTwrIncomplete: false,
    relative: null,
    benchmarkYtdTwr: null,
    income: {
      projectedTwelveMonth: null,
      trailingTwelveMonth: null,
      thisMonth: null,
      dividendTaxRate: null,
    },
    upcomingDividends: [],
    recentDividends: [],
    allocation: [],
    history: { points: [], changePercent: 0, changeAmount: { amount: "0", currency: "USD" } },
    ...overrides,
  };
}

const NOW = new Date("2026-07-12T12:00:00Z");
const TODAY_ISO = "2026-07-12";

describe("toBriefInput", () => {
  it("totalValue is the formatted last history point value", () => {
    const input = toBriefInput(
      dashboard({
        history: {
          points: [point("1000"), point("1284502")],
          changePercent: 0,
          changeAmount: { amount: "0", currency: "USD" },
        },
      }),
      ALL_ON,
      NOW,
    );
    expect(input.totalValue).toBe("$1,284,502.00");
  });

  it("totalValue is null when there are no history points", () => {
    expect(toBriefInput(dashboard(), ALL_ON, NOW).totalValue).toBeNull();
  });

  it("maps todayChange with a formatted amount", () => {
    const input = toBriefInput(
      dashboard({ todayChange: { amount: { amount: "4120", currency: "USD" }, percent: 0.32 } }),
      ALL_ON,
      NOW,
    );
    expect(input.todayChange).toEqual({ amount: "$4,120.00", percent: 0.32 });
  });

  it("todayChange is null when the dashboard has none", () => {
    expect(toBriefInput(dashboard(), ALL_ON, NOW).todayChange).toBeNull();
  });

  it("picks the biggest absolute mover with a signed percent", () => {
    const input = toBriefInput(
      dashboard({ positions: [pos("AAPL", 1.2), pos("NORDA-B", -3.4)] }),
      ALL_ON,
      NOW,
    );
    expect(input.mover).toEqual({ symbol: "NORDA-B", percent: -3.4 });
  });

  it("mover is null when nothing moved", () => {
    expect(
      toBriefInput(dashboard({ positions: [pos("AAPL", null), pos("O", 0)] }), ALL_ON, NOW).mover,
    ).toBeNull();
  });

  it("reports positionsCount from positions", () => {
    const input = toBriefInput(dashboard({ positions: [pos("A", 1), pos("B", 2)] }), ALL_ON, NOW);
    expect(input.positionsCount).toBe(2);
  });

  describe("paydays", () => {
    it("maps recent dividends in the display currency and totals them", () => {
      const input = toBriefInput(
        dashboard({
          displayCurrency: "USD",
          recentDividends: [
            dividend({ symbol: "MPAY", income: "312", currency: "USD" }),
            dividend({ symbol: "AAPL", income: "121", currency: "USD" }),
          ],
        }),
        ALL_ON,
        NOW,
      );
      expect(input.paydays).toEqual([
        { symbol: "MPAY", income: "$312.00" },
        { symbol: "AAPL", income: "$121.00" },
      ]);
      expect(input.paydaysTotal).toBe("$433.00");
    });

    it("filters out rows not in the display currency (no dishonest mixed sum)", () => {
      const input = toBriefInput(
        dashboard({
          displayCurrency: "USD",
          recentDividends: [
            dividend({ symbol: "MPAY", income: "312", currency: "USD" }),
            dividend({ symbol: "NORDA-B", income: "500", currency: "DKK" }),
          ],
        }),
        ALL_ON,
        NOW,
      );
      expect(input.paydays).toEqual([{ symbol: "MPAY", income: "$312.00" }]);
      expect(input.paydaysTotal).toBe("$312.00");
    });

    it("is empty (and total null) when paydayGreeting is off", () => {
      const input = toBriefInput(
        dashboard({
          displayCurrency: "USD",
          recentDividends: [dividend({ symbol: "MPAY", income: "312", currency: "USD" })],
        }),
        { ...ALL_ON, paydayGreeting: false },
        NOW,
      );
      expect(input.paydays).toEqual([]);
      expect(input.paydaysTotal).toBeNull();
    });

    it("is empty when there are no recent dividends", () => {
      const input = toBriefInput(dashboard({ displayCurrency: "USD" }), ALL_ON, NOW);
      expect(input.paydays).toEqual([]);
      expect(input.paydaysTotal).toBeNull();
    });

    it("nets paydays income and total by the dashboard's dividend tax rate", () => {
      const input = toBriefInput(
        dashboard({
          displayCurrency: "USD",
          recentDividends: [
            dividend({ symbol: "MPAY", income: "312", currency: "USD" }),
            dividend({ symbol: "AAPL", income: "121", currency: "USD" }),
          ],
          income: {
            projectedTwelveMonth: null,
            trailingTwelveMonth: null,
            thisMonth: null,
            dividendTaxRate: 35,
          },
        }),
        ALL_ON,
        NOW,
      );
      expect(input.paydays).toEqual([
        { symbol: "MPAY", income: "$202.80" }, // 312 * 0.65
        { symbol: "AAPL", income: "$78.65" }, // 121 * 0.65
      ]);
      expect(input.paydaysTotal).toBe("$281.45"); // 433 * 0.65
    });
  });

  describe("nextPayout", () => {
    it("is 'today' when the first upcoming payment is today", () => {
      const input = toBriefInput(
        dashboard({
          upcomingDividends: [
            upcoming({ symbol: "MPAY", date: TODAY_ISO, income: "312", currency: "USD" }),
          ],
        }),
        ALL_ON,
        NOW,
      );
      expect(input.nextPayout).toEqual({ symbol: "MPAY", income: "$312.00", when: "today" });
    });

    it("is 'thisWeek' when the payment is within seven days", () => {
      const input = toBriefInput(
        dashboard({
          upcomingDividends: [
            upcoming({ symbol: "MPAY", date: "2026-07-17", income: "312", currency: "USD" }),
          ],
        }),
        ALL_ON,
        NOW,
      );
      expect(input.nextPayout).toEqual({ symbol: "MPAY", income: "$312.00", when: "thisWeek" });
    });

    it("is null when the payment is more than seven days out", () => {
      const input = toBriefInput(
        dashboard({
          upcomingDividends: [upcoming({ symbol: "MPAY", date: "2026-07-25" })],
        }),
        ALL_ON,
        NOW,
      );
      expect(input.nextPayout).toBeNull();
    });

    it("carries the date the API already resolved (paymentDate falling back to exDate happens upstream, in selectUpcoming)", () => {
      const input = toBriefInput(
        dashboard({
          upcomingDividends: [upcoming({ symbol: "MPAY", date: TODAY_ISO, income: "10" })],
        }),
        ALL_ON,
        NOW,
      );
      expect(input.nextPayout).toEqual({ symbol: "MPAY", income: "$10.00", when: "today" });
    });

    it("is null when there are no upcoming dividends", () => {
      expect(toBriefInput(dashboard(), ALL_ON, NOW).nextPayout).toBeNull();
    });

    it("nets the next payout income by the dashboard's dividend tax rate", () => {
      const input = toBriefInput(
        dashboard({
          upcomingDividends: [
            upcoming({ symbol: "MPAY", date: TODAY_ISO, income: "312", currency: "USD" }),
          ],
          income: {
            projectedTwelveMonth: null,
            trailingTwelveMonth: null,
            thisMonth: null,
            dividendTaxRate: 35,
          },
        }),
        ALL_ON,
        NOW,
      );
      expect(input.nextPayout).toEqual({ symbol: "MPAY", income: "$202.80", when: "today" });
    });
  });
});
