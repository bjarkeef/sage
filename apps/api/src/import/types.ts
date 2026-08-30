export type ImportTransactionType = "buy" | "sell" | "dividend" | "split";

export interface ImportTransaction {
  symbol: string;
  type: ImportTransactionType;
  quantity: string;
  price: string;
  currency: string;
  tradeDate: string;
  fee: string | null;
  feeCurrency: string | null;
  exchange: string;
  rowNumber: number;
}

export interface SkippedRow {
  row: number;
  symbol: string;
  event: string;
  reason: string;
}

export interface ImportInstrument {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: string;
}

export interface ImportSummary {
  buys: number;
  sells: number;
  dividends: number;
  splits: number;
  skipped: number;
  newInstruments: number;
}

export interface ImportPriceMark {
  symbol: string;
  date: string;
  price: string;
  currency: string;
}

export interface ImportCustomSettings {
  symbol: string;
  name: string | null;
  note: string | null;
  sector: string | null;
  currency: string;
  holdingType: "savings" | "other";
  incomeEnabled: boolean;
  incomeYearlyPct: string | null;
  frequencyUnit: "week" | "month" | "quarter" | "year" | null;
  frequencyInterval: number;
  firstPaymentDate: string | null;
  lastPaymentDate: string | null;
  reinvest: boolean;
  autoAdd: boolean;
}

export interface ParseResult {
  transactions: ImportTransaction[];
  skipped: SkippedRow[];
  instruments: ImportInstrument[];
  warnings: string[];
  summary: ImportSummary;
  priceMarks: ImportPriceMark[];
  customSettings: ImportCustomSettings[];
}
