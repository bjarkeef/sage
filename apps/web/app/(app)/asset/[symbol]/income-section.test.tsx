import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IncomeSection, YourIncome } from "./income-section";
import { AnswerStrip } from "./answer-strip";
import {
  TODAY,
  assetDetail,
  day,
  nonPayer,
  notHeld,
  ratings,
} from "../../../../lib/test/asset-fixtures";
import { formatDate } from "../../../../lib/format";
import type { AssetDetailDTO } from "../../../../lib/types";

describe("YourIncome", () => {
  it("shows next payment, next 12 months, yield on cost, received so far and rhythm — after tax", () => {
    render(<YourIncome detail={assetDetail()} taxRate={35} todayISO={TODAY} />);
    expect(screen.getByText("$32.50")).toBeInTheDocument(); // 0.50 × 100 × 0.65
    expect(screen.getByText("Aug 29, 2026 · confirmed")).toBeInTheDocument();
    expect(screen.getByText("$130.00")).toBeInTheDocument(); // 2.00 × 100 × 0.65
    expect(screen.getByText("3.25%")).toBeInTheDocument(); // 5% × 0.65
    expect(screen.getByText("$97.50")).toBeInTheDocument(); // 150 received (ledger, gross) × 0.65
    expect(screen.getByText("Received so far")).toBeInTheDocument();
    expect(screen.getByText("quarterly")).toBeInTheDocument();
    expect(screen.getAllByText("after tax").length).toBeGreaterThanOrEqual(3);
  });

  it("prints the same next-12-months figure as the strip's 'Pays you' — one producer", () => {
    render(
      <>
        <AnswerStrip
          detail={assetDetail()}
          taxRate={35}
          todayISO={TODAY}
          weight={{ ok: true, value: 0.08 }}
          ratings={ratings()}
          addAction={null}
        />
        <YourIncome detail={assetDetail()} taxRate={35} todayISO={TODAY} />
      </>,
    );
    expect(screen.getAllByText("$130.00")).toHaveLength(2);
  });

  it("lists every payment as money with its year, one font per column, on request", () => {
    render(<YourIncome detail={assetDetail()} taxRate={35} todayISO={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "All 4 payments" }));
    expect(screen.getAllByText("$0.50")).toHaveLength(4);
    expect(screen.queryByText(/0\.50 USD/)).not.toBeInTheDocument();
    expect(screen.getByText(formatDate(day(-30), { year: "always" }))).toBeInTheDocument();
  });

  it("says 'Nothing yet' rather than $0.00 before anything has been received", () => {
    const d = assetDetail();
    render(
      <YourIncome
        detail={{ ...d, position: { ...d.position, dividendsReceived: null } }}
        taxRate={35}
        todayISO={TODAY}
      />,
    );
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("flags a received total that leaves out payments it could not convert", () => {
    const d = assetDetail();
    render(
      <YourIncome
        detail={{
          ...d,
          position: {
            ...d.position,
            dividendsReceived: { amount: "150.00", currency: "USD", leftOut: 2 },
          },
        }}
        taxRate={35}
        todayISO={TODAY}
      />,
    );
    expect(screen.getByText("$97.50")).toBeInTheDocument();
    expect(
      screen.getByRole("note", {
        name: "Check: 2 payments in another currency are left out: no exchange rate",
      }),
    ).toBeInTheDocument();
  });

  it("says 'before tax' when no rate is set", () => {
    render(<YourIncome detail={assetDetail()} taxRate={null} todayISO={TODAY} />);
    expect(screen.getByText("$200.00")).toBeInTheDocument();
    expect(screen.getAllByText("before tax").length).toBeGreaterThanOrEqual(1);
  });
});

describe("IncomeSection", () => {
  it("shows the per-share bars and your income for a held payer", () => {
    render(<IncomeSection detail={assetDetail()} taxRate={35} todayISO={TODAY} />);
    expect(screen.getByRole("heading", { name: "What it pays you" })).toBeInTheDocument();
    expect(screen.getByText("Per share, by year")).toBeInTheDocument();
    expect(screen.getByText("Your income")).toBeInTheDocument();
  });

  it("keeps the payments list on the per-share card for a payer you don't hold", () => {
    render(<IncomeSection detail={notHeld()} taxRate={35} todayISO={TODAY} />);
    expect(screen.queryByText("Your income")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All 4 payments" })).toBeInTheDocument();
  });

  it("is absent for a holding that never paid", () => {
    const { container } = render(
      <IncomeSection detail={nonPayer()} taxRate={35} todayISO={TODAY} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a custom holding's own income card", () => {
    const custom: AssetDetailDTO = {
      ...assetDetail(),
      upcoming: [],
      custom: {
        holdingType: "savings",
        note: null,
        income: {
          yearlyPct: "4.25",
          frequencyUnit: "quarter",
          frequencyInterval: 1,
          firstPaymentDate: day(-46),
          lastPaymentDate: null,
          reinvest: true,
          nextPaymentDate: day(45),
        },
      },
    };
    render(<IncomeSection detail={custom} taxRate={35} todayISO={TODAY} />);
    expect(screen.getByText("Every quarter")).toBeInTheDocument();
    expect(screen.getByText("Reinvested")).toBeInTheDocument();
    expect(screen.getByText(formatDate(day(45), { year: "always" }))).toBeInTheDocument();
    expect(screen.queryByText("Per share, by year")).not.toBeInTheDocument();
  });
});
