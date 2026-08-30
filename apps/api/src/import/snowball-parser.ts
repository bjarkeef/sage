import Papa from "papaparse";
import { Decimal } from "@sage/core";
import type {
  ParseResult,
  ImportTransaction,
  ImportTransactionType,
  SkippedRow,
  ImportInstrument,
  ImportPriceMark,
  ImportCustomSettings,
} from "./types";

interface SnowballRawRow {
  Event: string;
  Date: string;
  Symbol: string;
  Price: string;
  Quantity: string;
  Currency: string;
  FeeTax: string;
  Exchange: string;
  FeeCurrency: string;
  DoNotAdjustCash: string;
  Note: string;
}

const EVENT_MAP: Record<string, ImportTransactionType> = {
  BUY: "buy",
  SELL: "sell",
  DIVIDEND: "dividend",
  SPLIT: "split",
};

const SKIP_EVENTS = new Set([
  "STOCK_AS_DIVIDEND",
  "CUSTOM_HOLDING_PRICE",
  "CUSTOM_HOLDING_SETTINGS",
]);

const EXCHANGE_SUFFIX: Record<string, string> = {
  XETRA: ".DE",
  STU: ".SG",
  CO: ".CO",
  ST: ".ST",
  LSE: ".L",
  PA: ".PA",
  MI: ".MI",
  AS: ".AS",
};

const PERIOD_TYPE: Record<number, "week" | "month" | "quarter" | "year"> = {
  2: "week",
  3: "month",
  4: "quarter",
  5: "year",
};

function parseCustomSettings(row: SnowballRawRow): ImportCustomSettings | null {
  try {
    const decoded = JSON.parse(row.Note.replaceAll("@*@", '"')) as {
      Holding?: {
        Note?: string | null;
        Currency?: string;
        Description?: string | null;
        Sector?: string | null;
      };
      Settings?: {
        CustomHoldingType?: number;
        GenerateIncome?: boolean;
        IncomeAmount?: number | null;
        IsIncomeReinvested?: boolean;
        Period?: number | null;
        PeriodType?: number;
        FirstIncomeDate?: string | null;
        MaturityDate?: string | null;
      };
    };
    const s = decoded.Settings ?? {};
    const h = decoded.Holding ?? {};
    const incomeEnabled = s.GenerateIncome === true;
    const frequencyUnit = s.PeriodType != null ? (PERIOD_TYPE[s.PeriodType] ?? null) : null;
    if (incomeEnabled && frequencyUnit === null) return null; // unknown cadence — unsafe to generate
    const dateOf = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
    return {
      symbol: row.Symbol,
      name: h.Description ?? null,
      note: h.Note ?? null,
      sector: h.Sector ?? null,
      currency: h.Currency ?? row.Currency,
      holdingType: s.CustomHoldingType === 2 ? "savings" : "other",
      incomeEnabled,
      incomeYearlyPct: s.IncomeAmount != null ? new Decimal(s.IncomeAmount).toFixed() : null,
      frequencyUnit,
      frequencyInterval: s.Period ?? 1,
      firstPaymentDate: dateOf(s.FirstIncomeDate),
      lastPaymentDate: dateOf(s.MaturityDate),
      reinvest: s.IsIncomeReinvested === true,
      autoAdd: incomeEnabled,
    };
  } catch {
    return null;
  }
}

export function parseSnowballCSV(csvText: string): ParseResult {
  const { data } = Papa.parse<SnowballRawRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const transactions: ImportTransaction[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: string[] = [];
  const instrumentMap = new Map<string, ImportInstrument>();
  const priceMarks: ImportPriceMark[] = [];
  const customSettings: ImportCustomSettings[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i]!;
    const rowNum = i + 2; // 1-indexed + header row

    const isCustom = row.Exchange === "CUSTOM_HOLDING";

    if (isCustom && row.Event === "CUSTOM_HOLDING_PRICE") {
      priceMarks.push({
        symbol: row.Symbol,
        date: row.Date.split(" ")[0]!,
        price: row.Price,
        currency: row.Currency,
      });
      continue;
    }

    if (isCustom && row.Event === "CUSTOM_HOLDING_SETTINGS") {
      const settings = parseCustomSettings(row);
      if (settings) customSettings.push(settings);
      else
        warnings.push(`Row ${rowNum}: could not decode custom-holding settings for ${row.Symbol}`);
      continue;
    }

    if (isCustom && row.Event === "STOCK_AS_DIVIDEND") {
      const fee = new Decimal(row.FeeTax || "0");
      transactions.push({
        symbol: row.Symbol,
        type: "buy",
        quantity: row.Quantity,
        price: "0", // reinvested income credits shares without cost basis
        currency: row.Currency,
        tradeDate: row.Date.split(" ")[0]!,
        fee: fee.greaterThan(0) ? row.FeeTax : null,
        feeCurrency: fee.greaterThan(0) ? row.Currency : null,
        exchange: "CUSTOM",
        rowNumber: rowNum,
      });
      if (!instrumentMap.has(row.Symbol)) {
        instrumentMap.set(row.Symbol, {
          symbol: row.Symbol,
          name: row.Symbol,
          exchange: "CUSTOM",
          currency: row.Currency,
          assetType: "custom",
        });
      }
      continue;
    }

    if (!isCustom && SKIP_EVENTS.has(row.Event)) {
      skipped.push({
        row: rowNum,
        symbol: row.Symbol,
        event: row.Event,
        reason: `Unsupported event: ${row.Event}`,
      });
      continue;
    }

    const type = EVENT_MAP[row.Event];
    if (!type) {
      skipped.push({
        row: rowNum,
        symbol: row.Symbol,
        event: row.Event,
        reason: `Unknown event: ${row.Event}`,
      });
      continue;
    }

    const tradeDate = row.Date.split(" ")[0]!;

    let quantity: string;
    let price: string;

    if (type === "split") {
      quantity = row.Price;
      price = "0";
    } else if (type === "dividend") {
      const rawPrice = new Decimal(row.Price);
      if (!rawPrice.isZero()) {
        price = row.Price;
        quantity = new Decimal(row.Quantity).dividedBy(rawPrice).toString();
      } else {
        price = row.Quantity;
        quantity = "1";
      }
    } else {
      quantity = row.Quantity;
      price = row.Price;
    }

    const feeNum = new Decimal(row.FeeTax);
    const fee = feeNum.greaterThan(0) ? row.FeeTax : null;
    const feeCurrency = fee ? row.FeeCurrency || row.Currency : null;

    const suffix = isCustom ? "" : (EXCHANGE_SUFFIX[row.Exchange] ?? "");
    const symbol = row.Symbol + suffix;

    transactions.push({
      symbol,
      type,
      quantity,
      price,
      currency: row.Currency,
      tradeDate,
      fee,
      feeCurrency,
      exchange: isCustom ? "CUSTOM" : row.Exchange,
      rowNumber: rowNum,
    });

    if (!instrumentMap.has(symbol)) {
      instrumentMap.set(symbol, {
        symbol,
        name: row.Symbol,
        exchange: isCustom ? "CUSTOM" : row.Exchange,
        currency: row.Currency,
        assetType: isCustom ? "custom" : "stock",
      });
    }
  }

  return {
    transactions,
    skipped,
    instruments: Array.from(instrumentMap.values()),
    warnings,
    priceMarks,
    customSettings,
    summary: {
      buys: transactions.filter((t) => t.type === "buy").length,
      sells: transactions.filter((t) => t.type === "sell").length,
      dividends: transactions.filter((t) => t.type === "dividend").length,
      splits: transactions.filter((t) => t.type === "split").length,
      skipped: skipped.length,
      newInstruments: instrumentMap.size,
    },
  };
}
