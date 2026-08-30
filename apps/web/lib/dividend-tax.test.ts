import { describe, it, expect } from "vitest";
import { netFactor, applyDividendTax, netAnnouncedDividends } from "./dividend-tax";
import type { AnnouncedDividendDTO, DividendIncomeDTO } from "./types";

describe("netFactor", () => {
  it("returns 1 for a null/undefined rate (gross)", () => {
    expect(netFactor(null)).toBe(1);
    expect(netFactor(undefined)).toBe(1);
  });
  it("converts a percent rate to a net multiplier", () => {
    expect(netFactor(35)).toBeCloseTo(0.65, 10);
    expect(netFactor(0)).toBe(1);
  });
});

function income(): DividendIncomeDTO {
  return {
    retroactive: [
      {
        symbol: "O",
        name: "Realty",
        exDate: "2026-07-01",
        paymentDate: "2026-07-01",
        paymentDateEstimated: false,
        amountPerShare: "0.271",
        sharesHeld: "20",
        income: "5.42",
        currency: "DKK",
      },
    ],
    projected: [
      {
        symbol: "KESTRL",
        name: "Kestrel",
        projectedExDate: "2026-07-31",
        paymentDate: "2026-07-31",
        paymentDateEstimated: true,
        confidence: "low",
        amountPerShare: "0.99",
        shares: "10",
        income: "10.00",
        currency: "DKK",
      },
    ],
    announced: [
      {
        symbol: "DKKB",
        name: "Cash account",
        declarationDate: null,
        exDate: "2026-07-30",
        recordDate: null,
        paymentDate: "2026-07-30",
        paymentDateEstimated: false,
        amountPerShare: "100",
        shares: "1",
        income: "100.00",
        currency: "DKK",
      },
    ],
    perHolding: [
      {
        symbol: "O",
        forwardAnnualIncome: { amount: "65.00", currency: "DKK" },
        incomeShare: 1,
        cagr5y: null,
        trend: "unknown",
      },
    ],
    summary: {
      trailingTwelveMonthIncome: [{ amount: "200.00", currency: "DKK" }],
      projectedTwelveMonthIncome: [{ amount: "100.00", currency: "DKK" }],
      monthlyBreakdown: [
        {
          month: "2026-07",
          retroactive: "5.42",
          announced: "100.00",
          projected: "10.00",
          currency: "DKK",
        },
      ],
      receivedByYear: [{ year: "2026", amount: "200.00", currency: "DKK" }],
    },
    incomeByGroup: {
      holdings: [
        { label: "O", amount: { amount: "60.00", currency: "DKK" }, share: 0.6 },
        { label: "KESTRL", amount: { amount: "40.00", currency: "DKK" }, share: 0.4 },
      ],
      sector: [{ label: "Real estate", amount: { amount: "100.00", currency: "DKK" }, share: 1 }],
      currency: [{ label: "DKK", amount: { amount: "100.00", currency: "DKK" }, share: 1 }],
    },
    dividendTaxRate: 35,
    fxIncomplete: false,
    incomeRecordingOff: false,
  };
}

describe("applyDividendTax", () => {
  it("returns the input unchanged (by reference) when f === 1", () => {
    const i = income();
    expect(applyDividendTax(i, 1)).toBe(i);
  });

  it("scales received/projected income and the yield basis, but leaves amountPerShare gross", () => {
    const net = applyDividendTax(income(), 0.65);
    expect(net.retroactive[0]!.income).toBe("3.52"); // 5.42 * 0.65
    expect(net.retroactive[0]!.amountPerShare).toBe("0.271"); // declared, untouched
    expect(net.retroactive[0]!.sharesHeld).toBe("20"); // untouched
    expect(net.announced[0]!.income).toBe("65.00"); // 100 * 0.65
    expect(net.announced[0]!.amountPerShare).toBe("100"); // declared, untouched
    expect(net.projected[0]!.income).toBe("6.50"); // 10 * 0.65
    expect(net.perHolding[0]!.forwardAnnualIncome.amount).toBe("42.25"); // 65 * 0.65 (→ net yield)
    expect(net.summary.projectedTwelveMonthIncome[0]!.amount).toBe("65.00"); // 100 * 0.65
    expect(net.summary.trailingTwelveMonthIncome[0]!.amount).toBe("130.00"); // 200 * 0.65
    expect(net.summary.monthlyBreakdown[0]!.announced).toBe("65.00");
    expect(net.summary.receivedByYear[0]!.amount).toBe("130.00");
  });

  it("scales every incomeByGroup amount but leaves shares alone", () => {
    const net = applyDividendTax(income(), 0.65);
    expect(net.incomeByGroup.holdings[0]!.amount.amount).toBe("39.00"); // 60 * 0.65
    expect(net.incomeByGroup.holdings[1]!.amount.amount).toBe("26.00"); // 40 * 0.65
    expect(net.incomeByGroup.sector[0]!.amount.amount).toBe("65.00");
    expect(net.incomeByGroup.currency[0]!.amount.amount).toBe("65.00");
    // share is a ratio of the whole — netting every amount leaves it unchanged
    expect(net.incomeByGroup.holdings[0]!.share).toBe(0.6);
  });

  it("netted group slices still reconcile to the netted forward total", () => {
    const net = applyDividendTax(income(), 0.65);
    const sliceSum = net.incomeByGroup.holdings.reduce((s, r) => s + Number(r.amount.amount), 0);
    const forward = Number(net.summary.projectedTwelveMonthIncome[0]!.amount);
    expect(sliceSum).toBeCloseTo(forward, 2);
  });
});

function announced(overrides: Partial<AnnouncedDividendDTO> = {}): AnnouncedDividendDTO {
  return {
    symbol: "O",
    name: "Realty",
    declarationDate: null,
    exDate: "2026-07-30",
    recordDate: null,
    paymentDate: "2026-07-30",
    paymentDateEstimated: false,
    amountPerShare: "100",
    shares: "1",
    income: "100.00",
    currency: "DKK",
    ...overrides,
  };
}

describe("netAnnouncedDividends", () => {
  it("returns the input unchanged (by reference) when f === 1", () => {
    const rows = [announced()];
    expect(netAnnouncedDividends(rows, 1)).toBe(rows);
  });

  it("scales income but leaves amountPerShare and shares gross", () => {
    const [net] = netAnnouncedDividends(
      [announced({ income: "100.00", amountPerShare: "100", shares: "1" })],
      0.65,
    );
    expect(net!.income).toBe("65.00");
    expect(net!.amountPerShare).toBe("100"); // declared, untouched
    expect(net!.shares).toBe("1"); // untouched
  });

  it("nets every row independently", () => {
    const rows = netAnnouncedDividends(
      [
        announced({ symbol: "O", income: "100.00" }),
        announced({ symbol: "KESTRL", income: "10.00" }),
      ],
      0.65,
    );
    expect(rows.map((r) => r.income)).toEqual(["65.00", "6.50"]);
  });
});
