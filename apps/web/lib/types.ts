export type MoneyDTO = { amount: string; currency: string };

export interface QuoteDTO {
  price: MoneyDTO;
  asOf: string;
}

export interface BasisFindingDTO {
  symbol: string;
  /** Median factor between what was paid and what the price series says. */
  factor: number;
  /** How many of this symbol's checked transactions disagree. */
  mismatched: number;
  /** How many could be checked at all — a transaction with no stored bar is
   *  unchecked, which is not the same as clean. */
  samples: number;
  firstDate: string;
  lastDate: string;
}

export interface PositionDTO {
  symbol: string;
  name: string;
  exchange: string;
  /** Display currency — converted, so it may not be what the ledger stores. */
  currency: string;
  /** The currency this position's transactions are recorded in. Use this, not
   *  `currency`, when writing back to the ledger: the API rejects a transaction
   *  whose currency disagrees with the symbol's existing entries. */
  nativeCurrency: string;
  quantity: string;
  averageCost: MoneyDTO;
  costBasis: MoneyDTO;
  currentPrice: MoneyDTO | null;
  marketValue: MoneyDTO | null;
  unrealizedGainLoss: MoneyDTO | null;
  gainLossPercent: number | null;
  dailyChange: MoneyDTO | null;
  dailyChangePercent: number | null;
  dividendIncome: MoneyDTO | null;
  totalReturn: MoneyDTO | null;
  totalReturnPercent: number | null;
  website: string | null;
  yieldOnCost: number | null;
  /** Set when this holding's transacted prices and its stored price history are
   *  on different share bases. Figures involving it may be wrong; nothing is
   *  corrected. */
  basisMismatch: BasisFindingDTO | null;
  /** Trailing daily closes (≤30, oldest→newest); present only when requested. */
}

export interface SubtotalDTO {
  currency: string;
  costBasis: MoneyDTO;
  marketValue: MoneyDTO;
  gainLoss: MoneyDTO;
}

export interface PortfolioDTO {
  positions: PositionDTO[];
  subtotalsByCurrency: SubtotalDTO[];
}

export interface SearchResultDTO {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: "stock" | "etf" | "fund" | "index" | "other";
}

export type TransactionType = "buy" | "sell" | "dividend" | "split";

export interface TransactionRow {
  id: string;
  instrumentSymbol: string;
  name: string;
  type: TransactionType;
  quantity: string;
  price: string;
  currency: string;
  fee: string | null;
  feeCurrency: string | null;
  tradeDate: string;
  /** 'auto' = created by dividend auto-reconciliation. */
  source: string | null;
}

export interface CreateTransactionInput {
  instrument: SearchResultDTO;
  type: TransactionType;
  quantity: string;
  price: string;
  tradeDate: string;
  fee?: string;
  feeCurrency?: string;
}

export interface UpdateTransactionInput {
  type: TransactionType;
  quantity: string;
  price: string;
  tradeDate: string;
  fee?: string;
  feeCurrency?: string;
}

export interface PortfolioHistoryPoint {
  date: string;
  value: MoneyDTO;
  invested: MoneyDTO;
}

export interface BenchmarkDTO {
  symbol: string;
  name: string;
  points: { date: string; percentChange: number }[];
}

export interface PortfolioHistoryDTO {
  points: PortfolioHistoryPoint[];
  changePercent: number;
  changeAmount: MoneyDTO;
  benchmarks?: BenchmarkDTO[];
  /** True when some date in the series had no historical ECB rate and fell
   *  back to today's spot rate — the chart is approximate, not exact. */
  fxApproximated?: boolean;
  /** True when a held currency could not be priced at all, so its holding is
   *  missing from these points — the chart reads low. */
  fxIncomplete?: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — the chart is approximate. */
  fxStale?: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf?: string | null;
  /** Holdings carried on a close older than the app's staleness bound. They
   *  are still in the totals, at those prices. */
  stalePrices: StalePriceDTO[];
}

export interface RetroactiveIncomeRowDTO {
  symbol: string;
  name: string;
  exDate: string;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  /**
   * Null when provenance cannot guarantee a per-share figure — imported ledger
   * rows record only the total cash. Render an em dash rather than guessing.
   */
  amountPerShare: string | null;
  sharesHeld: string | null;
  income: string;
  currency: string;
}

export interface ProjectedIncomeRowDTO {
  symbol: string;
  name: string;
  projectedExDate: string;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  confidence: "high" | "low";
  amountPerShare: string;
  shares: string;
  income: string;
  currency: string;
}

/** A calendar-only forecast row past the 12-month horizon. */
export interface LongRangeIncomeRowDTO extends ProjectedIncomeRowDTO {
  /** Yearly dividend growth applied, in percent; null when none was (a custom
   *  holding, or too little history for a 5-year rate). */
  growthPct: number | null;
}

export interface AnnouncedDividendDTO {
  symbol: string;
  name: string;
  declarationDate: string | null;
  exDate: string;
  recordDate: string | null;
  paymentDate: string | null;
  paymentDateEstimated: boolean;
  amountPerShare: string;
  shares: string;
  income: string;
  currency: string;
}

export interface MonthlyBreakdownDTO {
  month: string;
  retroactive: string;
  announced: string;
  projected: string;
  currency: string;
}

export type DividendTrend = "climbing" | "flat" | "cutting" | "unknown";

export interface DividendPerHoldingDTO {
  symbol: string;
  forwardAnnualIncome: MoneyDTO;
  incomeShare: number;
  cagr5y: string | null;
  trend: DividendTrend;
}

export interface ReceivedByYearDTO {
  year: string;
  amount: string;
  currency: string;
}

export interface IncomeGroupRow {
  label: string;
  amount: MoneyDTO;
  share: number;
}

export interface DividendIncomeDTO {
  retroactive: RetroactiveIncomeRowDTO[];
  projected: ProjectedIncomeRowDTO[];
  announced: AnnouncedDividendDTO[];
  perHolding: DividendPerHoldingDTO[];
  summary: {
    trailingTwelveMonthIncome: MoneyDTO[];
    projectedTwelveMonthIncome: MoneyDTO[];
    monthlyBreakdown: MonthlyBreakdownDTO[];
    receivedByYear: ReceivedByYearDTO[];
  };
  incomeByGroup: {
    holdings: IncomeGroupRow[];
    sector: IncomeGroupRow[];
    currency: IncomeGroupRow[];
  };
  /** Single configurable dividend tax rate (0-100), null when unset. Drives
   *  the Yield card's net-after-tax headline; see `apps/web/lib/portfolio-yields.ts`. */
  dividendTaxRate: number | null;
  /** The last ex-date of the 12-month forecast in `projected`. Server-sent: the
   *  projection rule lives in `@sage/core`, which the web app deliberately does
   *  not depend on. */
  projectedThrough?: string;
  /** Calendar-only forecast after `projectedThrough`, through
   *  `longRangeThrough` (31 December three years out). Optional: an older API
   *  sends neither. */
  longRange?: LongRangeIncomeRowDTO[];
  longRangeThrough?: string;
  /** True when a received dividend was excluded from totals for want of an FX rate. */
  fxIncomplete: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — totals are approximate. */
  fxStale?: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf?: string | null;
  /**
   * True when dividend auto-recording is genuinely off (the portfolio's
   * `autoAddDividends` setting) AND nothing is recorded but the provider shows
   * this book pays dividends. A freshly bought payer whose first dividend
   * since purchase simply hasn't landed yet is NOT this case.
   */
  incomeRecordingOff: boolean;
}

export interface FundHoldingDTO {
  name: string;
  symbol: string | null;
  weight: number;
}

export interface SectorWeightDTO {
  sector: string;
  weight: number;
}

export interface FundProfileDTO {
  expenseRatio: string | null;
  totalAssets: string | null;
  family: string | null;
  category: string | null;
  legalType: string | null;
  holdings: FundHoldingDTO[];
  sectorWeightings: SectorWeightDTO[];
}

export interface AssetProfileDTO {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: string;
  sector: string | null;
  industry: string | null;
  marketCap: string | null;
  peRatio: string | null;
  beta: string | null;
  fiftyTwoWeekHigh: MoneyDTO | null;
  fiftyTwoWeekLow: MoneyDTO | null;
  dividendYield: string | null;
  trailingAnnualDividend: MoneyDTO | null;
  website: string | null;
  description: string | null;
  ceo: string | null;
  fullTimeEmployees: string | null;
  ipoDate: string | null;
  country: string | null;
  countryIso: string | null;
  fund: FundProfileDTO | null;
}

export interface AssetPositionDTO {
  held: boolean;
  quantity?: string;
  averageCost?: MoneyDTO;
  costBasis?: MoneyDTO;
  marketValue?: MoneyDTO | null;
  unrealizedGainLoss?: MoneyDTO | null;
  gainLossPercent?: number | null;
  totalDividendIncome?: string;
  yieldOnCost?: number | null;
  feesPaid?: MoneyDTO;
  forwardAnnualIncome?: MoneyDTO | null;
  trades?: { tradeDate: string; type: "buy" | "sell"; price: string; quantity: string }[];
}

export interface AssetIncomeDTO {
  /** Trailing TTM ÷ live price, a fraction; null when unavailable. */
  currentYield: number | null;
  /** Trailing TTM ÷ average cost, a fraction; null when not held. */
  yieldOnCost: number | null;
  /** Deduped trailing 12-month dividend per share. */
  annualDividend: MoneyDTO | null;
  /** 5-year dividend CAGR as a fixed-6 fraction string. */
  dividendGrowth5y: string | null;
  /** Next projected ex-date (ISO), from cadence; null when not a payer. */
  nextExDate: string | null;
  /** Trailing payout ratio as a fraction; null when unknown. */
  payoutRatio: number | null;
}

export interface AssetDividendsDTO {
  history: {
    exDate: string;
    amountPerShare: string;
    currency: string;
    paymentDate: string | null;
  }[];
  cagr5y: string | null;
  trailingTwelveMonthTotal: string;
}

export interface AssetCustomIncomeDTO {
  yearlyPct: string;
  frequencyUnit: string;
  frequencyInterval: number;
  firstPaymentDate: string;
  lastPaymentDate: string | null;
  reinvest: boolean;
  /** First scheduled date strictly after today; null when income is
   *  disabled or the schedule is exhausted within the lookahead window. */
  nextPaymentDate: string | null;
}

export interface AssetCustomDTO {
  holdingType: string;
  note: string | null;
  income: AssetCustomIncomeDTO | null;
}

export interface AssetDetailDTO {
  profile: AssetProfileDTO;
  quote: { price: MoneyDTO; asOf: string } | null;
  chart: { date: string; close: MoneyDTO }[];
  dividends: AssetDividendsDTO;
  position: AssetPositionDTO;
  income: AssetIncomeDTO;
  /** Set only for user-defined ("custom") holdings — savings accounts,
   *  pensions, etc. Null for regular market instruments. */
  custom: AssetCustomDTO | null;
}

export interface ImportTransactionDTO {
  symbol: string;
  type: TransactionType;
  quantity: string;
  price: string;
  currency: string;
  tradeDate: string;
  fee: string | null;
  feeCurrency: string | null;
  exchange: string;
}

export interface ImportSkippedDTO {
  row: number;
  symbol: string;
  event: string;
  reason: string;
}

export interface ImportInstrumentDTO {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: string;
}

export interface ImportSummaryDTO {
  buys: number;
  sells: number;
  dividends: number;
  splits: number;
  skipped: number;
  deleted: number;
  newInstruments: number;
}

export interface ImportPreviewDTO {
  transactions: ImportTransactionDTO[];
  deleted: ImportTransactionDTO[];
  skipped: ImportSkippedDTO[];
  instruments: ImportInstrumentDTO[];
  warnings: string[];
  summary: ImportSummaryDTO;
}

export interface ImportResultDTO {
  /** The display currency this import set for a user who had none, else null.
   *  Optional: older API builds do not send it. */
  displayCurrencySet?: string | null;
  inserted: number;
  restored: number;
  claimedExisting: number;
  skippedDuplicates: number;
  instrumentsCreated: number;
}

export interface OverviewPrefs {
  brief: boolean;
  paydayGreeting: boolean;
  marketState: boolean;
  /** @deprecated superseded by incomeCard; still honored via fillDefaults. */
  incomeRoom: boolean;
  /** @deprecated superseded by portfolioCard; still honored via fillDefaults. */
  portfolioRoom: boolean;
  statStrip: boolean;
  /** The "living on it by <year>" progress band on the overview. */
  goalBand: boolean;
  performanceCard: boolean;
  incomeCard: boolean;
  portfolioCard: boolean;
  upcomingCard: boolean;
}

export interface UserSettingsDTO {
  /** Display name — what the overview greets you by. */
  name: string;
  displayCurrency: string | null;
  overviewPrefs: OverviewPrefs;
  dividendTaxRate: number | null;
  autoAddDividends: boolean;
  allowNegativeDividendGrowth: boolean;
}

export interface DiversificationDimRowDTO {
  symbol: string;
  name: string;
  bucket: string;
  marketValue: MoneyDTO;
  costValue: MoneyDTO;
  isFund: boolean;
  fundWeightPct?: number;
}

export interface ConstituentSourceDTO {
  type: "direct" | "fund";
  fundSymbol?: string;
  marketValue: MoneyDTO;
  costValue: MoneyDTO;
}

export interface ConstituentDTO {
  key: string;
  symbol: string | null;
  name: string;
  marketValue: MoneyDTO;
  costValue: MoneyDTO;
  sources: ConstituentSourceDTO[];
}

export interface DiversificationViewDTO {
  currency: string;
  totals: { marketValue: MoneyDTO; costBasis: MoneyDTO };
  dimensions: {
    sector: { plain: DiversificationDimRowDTO[]; xray: DiversificationDimRowDTO[] };
    country: DiversificationDimRowDTO[];
    region: DiversificationDimRowDTO[];
    assetClass: DiversificationDimRowDTO[];
    currency: DiversificationDimRowDTO[];
  };
  holdingsXray: ConstituentDTO[];
  /** True when some held currency had no FX rate — those amounts are shown unconverted. */
  fxIncomplete: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — totals are approximate. */
  fxStale?: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf?: string | null;
}

export interface DashboardIncomeDTO {
  projectedTwelveMonth: MoneyDTO | null;
  trailingTwelveMonth: MoneyDTO | null;
  /** `received` = paid so far this month; `projected` = the full month (received
   *  + confirmed + estimated). Both GROSS — the client nets them by `dividendTaxRate`. */
  thisMonth: { received: MoneyDTO; projected: MoneyDTO } | null;
  /** Flat dividend tax rate (0-100), null when unset. Drives the after-tax income figure. */
  dividendTaxRate: number | null;
}

/** How sure Sage is that a payment happens for the amount shown — the three
 *  arrays the income view already separates, named. Drives the overview
 *  stream's tone ramp; see `--certainty-*` in tokens.css. */
export type PaymentCertainty = "paid" | "confirmed" | "estimated";

export interface IncomeStreamPointDTO {
  /** Payment date, or the ex-date when the payer named none. */
  date: string;
  /** Display currency, GROSS — the client nets it by `dividendTaxRate`, as
   *  every other income surface does. */
  amount: string;
  currency: string;
  symbol: string;
  certainty: PaymentCertainty;
}

export interface UpcomingRow {
  symbol: string;
  name: string;
  /** The date the card displays — payment date, or ex-date when unknown. */
  date: string;
  income: string;
  currency: string;
  /** Sage predicted this date rather than the company declaring it. */
  dateEstimated: boolean;
  /** The whole payment is a forecast, not a declared dividend. */
  projected: boolean;
}

export interface DashboardDTO {
  displayCurrency: string | null;
  positions: PositionDTO[];
  subtotalsByCurrency: SubtotalDTO[];
  /** True when a display currency is set but some holdings lacked FX rates. */
  fxIncomplete?: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — totals are approximate. */
  fxStale?: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf?: string | null;
  todayChange: { amount: MoneyDTO; percent: number } | null;
  /** Display-currency total return (price gain/loss + lifetime dividends),
   *  aggregated across holdings. Null when no display currency is set. */
  /** What the book has made over its whole life: unrealised gain, every sale
   *  ever made, and income banked after tax. No percentage — see the API's
   *  dashboard route for why a lifetime gain has no agreed denominator. */
  totalReturn: { amount: MoneyDTO } | null;
  /** YTD time-weighted return (fraction, e.g. 0.042 = +4.2%). Embedded so
   *  the overview does not need a separate GET /performance call. */
  ytdTwr: number | null;
  /** True when the YTD figure was computed over price history that begins
   *  after a holding was first held, so it covers less than it claims.
   *  `/performance` names which holdings and repairs the stored history. */
  ytdTwrIncomplete: boolean;
  /** YTD figure measured against one benchmark, for the overview's Performance
   *  card. Null when no benchmark series reaches back to where the portfolio
   *  starts — the card degrades rather than inventing a comparison. */
  relative: PerformanceRelativeDTO | null;
  /** The primary benchmark's own YTD time-weighted return, for the overview's
   *  gap figure. PerformanceRelativeDTO deliberately carries risk ratios, not
   *  returns, so the comparison the card actually makes needs this separately. */
  benchmarkYtdTwr: number | null;
  income: DashboardIncomeDTO;
  /** Every payment twelve months back and twelve forward, one point each,
   *  ascending. The forward half is the span `income.projectedTwelveMonth`
   *  names, which is why the overview can show the figure and its own
   *  territory in one object. */
  incomeStream: IncomeStreamPointDTO[];
  /** Announced and projected rows within the next 30 days, ascending on the
   *  date each row displays, capped at 5, floored at 3 (reaches past the
   *  window rather than render fewer). */
  upcomingDividends: UpcomingRow[];
  /** Announced rows paid within [previous market day, today], ascending, capped at 3. */
  recentDividends: AnnouncedDividendDTO[];
  history: PortfolioHistoryDTO;
}

export interface PerformancePointDTO {
  date: string;
  value: number;
}

export interface PerformanceBenchmarkDTO {
  id: string;
  name: string;
  twr: number;
  points: PerformancePointDTO[];
}

export interface RelativeFigureDTO {
  /** The portfolio's figure. */
  value: number;
  /** The benchmark's own figure over the same window. */
  benchmark: number;
  /** value / benchmark. Null-checked upstream, never zero-denominator. */
  ratio: number;
}

export interface PerformanceRelativeDTO {
  benchmarkId: string;
  benchmarkName: string;
  /** Days surviving the inner join of the two return series. */
  pairedDays: number;
  /** The floor the API applied before reporting beta. Travels in the response
   *  so the UI never hardcodes a second copy that could drift from core's. */
  minPairedDaysForBeta: number;
  volatility: RelativeFigureDTO | null;
  maxDrawdown: RelativeFigureDTO | null;
  beta: number | null;
}

export interface StalePriceDTO {
  symbol: string;
  /** Date of the oldest close the holding is still being valued from. */
  asOf: string;
  /** Today's figure values it at a current quote; only the chart history is old. */
  quotedToday: boolean;
}

export interface PerformanceDTO {
  displayCurrency: string;
  range: string;
  window: { from: string; to: string; days: number } | null;
  insufficientData: boolean;
  /** Money the book made inside the window, deposits removed. Deliberately not
   *  a kroner reading of `twr`: a time-weighted return strips out cash flows
   *  and corresponds to no amount at all. */
  gain: MoneyDTO | null;
  /** That gain over what had been paid in when the window opened — the rate the
   *  overview prints. Published here so the two measures can be read together
   *  instead of discovered as a discrepancy between pages. */
  simpleReturn: number | null;
  twr: number | null;
  twrAnnualized: number | null;
  /** Realised gains and income banked over the WHOLE book, not this window.
   *  Null when the series could not be built. */
  lifetime: {
    unrealised: MoneyDTO;
    realised: MoneyDTO;
    income: MoneyDTO;
    total: MoneyDTO;
  } | null;
  volatility: number | null;
  maxDrawdown: number | null;
  bestDay: PerformancePointDTO | null;
  worstDay: PerformancePointDTO | null;
  indexSeries: PerformancePointDTO[];
  benchmarks: PerformanceBenchmarkDTO[];
  /** Benchmark-relative positions for the risk figures. Null when no benchmark
   *  could be fetched — the figures above still render. */
  relative: PerformanceRelativeDTO | null;
  /** Holdings whose price basis disagrees with the ledger. Empty on a clean
   *  book; nothing here changes any figure above. Excludes holdings whose
   *  mismatch a recorded split explained and the series corrected. */
  basisMismatches: BasisFindingDTO[];
  /** Symbols carrying a recorded split whose share basis could not be checked.
   *  Nothing was corrected for these. The reason is NOT uniform — see
   *  `fxGapSymbols`, which names the ones that failed for the other cause. */
  unverifiedSplits: string[];
  /** Which of `unverifiedSplits` went unchecked because a trade's currency had
   *  no FX rate to convert against its stored bar, rather than because no
   *  trade landed on a stored-price day at all. Bars exist for these, so
   *  backfilling price history would not change them. Optional so older cached
   *  responses degrade to "cause unknown", not to a crash. */
  fxGapSymbols?: string[];
  /** Every symbol in the ledger carrying a split transaction, regardless of
   *  its verdict. Lets a consumer tell a finding that corresponds to an
   *  actual recorded split (which /corporate-actions has a row for) apart
   *  from one on a symbol with no split at all (which it does not) — see
   *  `BasisMismatchCallout`'s link gate. Optional so older cached responses
   *  degrade to "assume no split", not to a crash. */
  splitSymbols?: string[];
  /** Holdings whose stored price history begins after they were first held,
   *  so part of the measured period cannot be valued and the figures above
   *  cover a shorter span than the range claims. Empty on a complete book. */
  historyIncomplete: string[];
  multiCurrency: boolean;
  /** Count of daily pairs excluded as price-data anomalies (r ≤ −1); 0 when clean. */
  anomalousDays: number;
  /** True when a flow (or the underlying valuation series) had no historical
   *  ECB rate for its date and fell back to today's spot rate — the IRR/TWR
   *  is an approximation, not exact. */
  fxApproximated: boolean;
  /** True when a flow's currency could not be priced at all, so it was left
   *  out of the IRR/TWR entirely rather than converted wrongly. */
  fxIncomplete?: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — the metrics are approximate. */
  fxStale?: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf?: string | null;
  /** Holdings carried on a close older than the app's staleness bound. They
   *  are still in the totals, at those prices. */
  stalePrices: StalePriceDTO[];
}

// ---- Goal (FI tracker) ----

export interface GoalDTO {
  type: "passive_income" | "value";
  amount: string;
  currency: string;
  targetYear: number;
  monthlyContribution: string | null;
  contributionIncrease: "none" | "inflation" | "custom";
  contributionIncreasePct: string | null;
  divYieldPct: string | null;
  divGrowthPct: string | null;
  annualReturnPct: string | null;
  adjustGoalForInflation: boolean;
  inflationPct: string;
  reinvestDividends: boolean;
  suggestAlternative: boolean;
}

export interface GoalDefaultsDTO {
  currency: string;
  divYieldPct: string | null;
  divGrowthPct: string | null;
  annualReturnPct: string | null;
  monthlyContribution: string;
  inflationPct: string;
  /** When set, an income goal amount is interpreted as NET (after-tax) income. */
  dividendTaxRate: number | null;
}

export interface GoalYearRowDTO {
  yearOffset: number;
  year: number;
  goal: string;
  annualContribution: string;
  monthlyContribution: string;
  value: string;
  income: string;
  achieved: boolean;
}

export interface GoalScenarioDTO {
  id: "portfolio" | "alternative";
  params: {
    divYieldPct: string;
    divGrowthPct: string;
    annualReturnPct: string;
    monthlyContribution: string;
    contributionGrowthPct: string;
    reinvestDividends: boolean;
  };
  changed?: { key: string; from: string; to: string }[];
  achievedInYears: number | null;
  achievedYear: number | null;
  rows: GoalYearRowDTO[];
}

export interface GoalResultDTO {
  netMode: boolean;
  currency: string;
  progressPct: number;
  currentMetric: string;
  goalAtTargetYear: string;
  targetYear: number;
  achievedInYears: number | null;
  achievedYear: number | null;
  scenarios: GoalScenarioDTO[];
}

export interface GoalViewDTO {
  goal: GoalDTO | null;
  defaults: GoalDefaultsDTO | null;
  result: GoalResultDTO | null;
  /** Prose for a human. Not a stable contract — read `reasonCode` to branch. */
  reason?: string;
  /**
   * Why there is no projection, as something the UI can switch on.
   *
   * `reason` was being rendered verbatim, so a new user met the goal page with
   * a lowercase sentence fragment and an "Open Settings" button — advice for
   * the multi-currency case, offered to someone whose actual problem was an
   * empty portfolio.
   */
  reasonCode?: "no_positions" | "multi_currency" | "goal_currency_stale";
}

export interface PutGoalInput {
  type: "passive_income" | "value";
  amount: number;
  targetYear: number;
  monthlyContribution: number | null;
  contributionIncrease: "none" | "inflation" | "custom";
  contributionIncreasePct: number | null;
  divYieldPct: number | null;
  divGrowthPct: number | null;
  annualReturnPct: number | null;
  adjustGoalForInflation: boolean;
  inflationPct: number;
  reinvestDividends: boolean;
  suggestAlternative: boolean;
}

// ---- Custom Holding ----

export interface CustomHoldingIncomeInput {
  yearlyPct: string;
  frequencyUnit: "week" | "month" | "quarter" | "year";
  frequencyInterval: number;
  firstPaymentDate: string;
  lastPaymentDate: string | null;
  reinvest: boolean;
  autoAdd: boolean;
}

export interface CustomHoldingInput {
  symbol: string;
  name: string;
  currency: string;
  holdingType: "savings" | "pension" | "other";
  sector: string | null;
  country: string | null;
  note: string | null;
  initialPrice: { date: string; price: string } | null;
  income: CustomHoldingIncomeInput | null;
}

export interface CustomHoldingDTO extends Omit<CustomHoldingInput, "initialPrice"> {
  incomeEnabled: boolean;
  priceMarks: { date: string; price: string }[];
}

// ---- Portfolio Categories ----

export interface CategoryHoldingDTO {
  symbol: string;
  name: string;
  website: string | null;
  value: MoneyDTO;
  invested: MoneyDTO;
  gain: MoneyDTO;
  gainPercent: number | null;
  /** Share of the node this holding sits in — not of the portfolio. */
  weightPct: number;
  /** Target share of the node this holding sits in; null when unset. */
  targetPct: number | null;
}

export interface CategoryNodeDTO {
  id: string;
  name: string;
  /** Share of the PARENT this node targets. */
  targetPct: number | null;
  /** Share of the parent this node actually holds. */
  actualPct: number;
  /** Rolled up: this node's own holdings plus every descendant's. */
  value: MoneyDTO;
  invested: MoneyDTO;
  gain: MoneyDTO;
  gainPercent: number | null;
  children: CategoryNodeDTO[];
  /** Holdings assigned directly to this node, not to its children. */
  holdings: CategoryHoldingDTO[];
  /** children.length + holdings.length — the "10 items" subtitle. */
  itemCount: number;
}

export interface CategoriesViewDTO {
  /** The portfolio itself. Its `value` covers everything held, `unallocated`
   *  included, so a child's `actualPct` is its share of the whole book. */
  root: CategoryNodeDTO;
  unallocated: CategoryHoldingDTO[];
  totals: {
    value: MoneyDTO;
    invested: MoneyDTO;
    gain: MoneyDTO;
    gainPercent: number | null;
    targetPctSum: number | null;
  };
  /** True when some held currency had no FX rate — those amounts are shown unconverted. */
  fxIncomplete: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — totals are approximate. */
  fxStale?: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf?: string | null;
}

/** One currency pair the book needs converting. Mirrors `FxPairStatus` in
 *  apps/api/src/routes/system.ts. */
export interface FxPairStatusDTO {
  /** The held/foreign currency. */
  from: string;
  /** The display currency. */
  to: string;
  /** Decimal string: units of `to` per 1 `from` ("1 USD = 6.5708 DKK").
   *  Null when unpriceable. */
  rate: string | null;
  /** `ecb` = cross-rated off the stored ECB reference series; `unavailable` =
   *  amounts pass through unconverted. */
  source: "ecb" | "unavailable";
}

export interface FxStatusDTO {
  displayCurrency: string | null;
  /** ECB publication day the rates come from (`YYYY-MM-DD`); null when nothing
   *  is stored yet or nothing is being converted. */
  ratesAsOf: string | null;
  /** Earliest publication day held in `fx_rate_daily` (`YYYY-MM-DD`); null
   *  when the table is empty. */
  coverageFrom: string | null;
  pairs: FxPairStatusDTO[];
}

export interface SystemEnvironmentDTO {
  nodeEnv: string;
  nodeVersion: string;
  /** Seconds since the API process started. */
  uptimeSeconds: number;
  signups: "open" | "closed";
  /** Applied migrations; null when the count could not be read. */
  schemaMigrations: number | null;
}

/** How one upstream provider has behaved since the API process started.
 *  Mirrors `ProviderHealthStatus` in apps/api/src/routes/system.ts. */
export interface ProviderHealthDTO {
  name: string;
  /** `unknown` = configured but not called since the API booted. */
  state: "healthy" | "degraded" | "unknown";
  /** Elapsed seconds, computed by the server — not a timestamp. */
  lastSuccessSecondsAgo: number | null;
  lastFailureSecondsAgo: number | null;
  lastFailureReason: "rate-limited" | "auth" | "unavailable" | null;
  consecutiveFailures: number;
}

export interface SystemProvidersDTO {
  marketData: string;
  enrichment: string;
  /** Whether each key is configured — the API never sends the values.
   *  `twelvedata` is optional: an API older than the Twelve Data adapter omits it. */
  keys: { eodhd: boolean; twelvedata?: boolean };
  health: ProviderHealthDTO[];
  /** Elapsed seconds since the oldest successful price fetch; null when no
   *  price is stored. Server-computed, not a timestamp. */
  pricesAgeSeconds: number | null;
  pricesStale: boolean;
  /** Held symbols with no stored quote at all. A fresh instance during an
   *  outage has nothing stored, so it is not STALE — there is no age to be old
   *  — but nothing can be priced either, and that needs its own notice. */
  pricesMissing: number;
  /** The part of `pricesMissing` added in the last few minutes — an import's
   *  new holdings, whose first fetch may not have landed yet. Optional: older
   *  API builds do not send it. */
  pricesPending?: number;
}

export interface SystemDTO {
  environment: SystemEnvironmentDTO;
  providers: SystemProvidersDTO;
  fx: FxStatusDTO;
}

export interface SaveCategoryInput {
  id?: string;
  name: string;
  targetPct: number | null;
  holdings: { symbol: string; targetPct?: number | null }[];
  children?: SaveCategoryInput[];
}

export interface SaveCategoriesInput {
  /** Root-level categories, nested. The payload IS the tree: there is no
   *  parent pointer to get wrong, and no way to describe a cycle. */
  categories: SaveCategoryInput[];
  /** Holdings sitting at the root with a target of their own. */
  rootHoldings: { symbol: string; targetPct: number }[];
}

// ---- News & Analyst Ratings ----

export interface NewsHoldingDTO {
  symbol: string;
  name: string;
  weightPct: number;
  dayChangePercent: number | null;
  website: string | null;
}

export interface NewsArticleDTO {
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  relatedSymbols: string[];
  /** Portfolio feed only — the held position this headline is attributed to.
   *  Absent from `GET /asset/:slug/news`, which is already scoped to one
   *  asset, so the row treats it as optional. */
  holding?: NewsHoldingDTO;
  /** Portfolio feed only — other held symbols the article also matched. */
  otherSymbols?: string[];
}

export type AnalystConsensusDTO = "strongBuy" | "buy" | "hold" | "sell" | "strongSell";

export interface RatingChangeDTO {
  firm: string;
  fromGrade: string | null;
  toGrade: string;
  action: string;
  date: string;
}

export interface AnalystRatingsDTO {
  consensusKey: AnalystConsensusDTO | null;
  distribution: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
  targets: {
    low: MoneyDTO | null;
    mean: MoneyDTO | null;
    high: MoneyDTO | null;
    median: MoneyDTO | null;
  };
  currentPrice: MoneyDTO | null;
  analystCount: number;
  asOf: string;
  upgradeHistory: RatingChangeDTO[];
}

export interface CorporateActionDTO {
  symbol: string;
  name: string | null;
  date: string;
  ratio: string;
  verdict: "adjusted" | "unadjusted" | "unverified";
  detectedFactor: number | null;
  mismatchedSamples: number | null;
  checkedSamples: number | null;
  pricesFrom: string | null;
  /** True when this symbol's basis could not be checked specifically because
   *  an FX rate was missing, not because price history is missing — bars
   *  already exist, so backfilling would not change anything. Only
   *  meaningful when `verdict` is `"unverified"`. */
  fxGap: boolean;
  /** The multiplier actually applied to quantities dated before this split:
   *  this row's ratio compounded with every LATER split of the same symbol,
   *  because `factorAt` multiplies all of them. `null` when this is the
   *  symbol's last split, where the row's own ratio already is the multiplier
   *  and the simpler sentence is the true one. */
  cumulativeFactor: number | null;
}

export interface CorporateActionsViewDTO {
  actions: CorporateActionDTO[];
  coverage: { checked: number; total: number };
}
