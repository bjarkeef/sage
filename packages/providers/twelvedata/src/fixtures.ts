/**
 * Twelve Data response shapes. The AAPL and VOO bodies and the plan, key and
 * invalid-symbol errors were captured from the live API on 2026-09-16 and
 * trimmed; the rate-limit and no-data envelopes follow the documented wording.
 * The London and search rows are fictional listings in the real shape.
 */
export const AAPL_QUOTE = {
  symbol: "AAPL",
  name: "Apple Inc.",
  exchange: "NASDAQ",
  mic_code: "XNGS",
  currency: "USD",
  datetime: "2026-09-16",
  timestamp: 1789565400,
  last_quote_at: 1789574220,
  open: "332.525",
  high: "335.47",
  low: "331.945",
  close: "332.695",
  volume: "466780",
  previous_close: "331.34000",
  is_market_open: true,
  fifty_two_week: { low: "236.32001", high: "344.57001" },
};

export const VOO_QUOTE = {
  symbol: "VOO",
  name: "Vanguard S&P 500 ETF",
  exchange: "NYSE",
  mic_code: "ARCX",
  currency: "USD",
  datetime: "2026-09-16",
  timestamp: 1789565400,
  last_quote_at: 1789574280,
  open: "698.18",
  high: "700",
  low: "697.49",
  close: "699.3",
  volume: "28068",
  previous_close: "696.20001",
  is_market_open: true,
  fifty_two_week: { low: "578.46002", high: "716.39001" },
};

export const PENCE_QUOTE = {
  symbol: "THAMES",
  name: "Thames Holdings plc",
  exchange: "LSE",
  mic_code: "XLON",
  currency: "GBp",
  datetime: "2026-09-16",
  timestamp: 1789545600,
  close: "1250.5",
  previous_close: "1240",
  is_market_open: false,
  fifty_two_week: { low: "1000", high: "1400" },
};

export const AAPL_TIME_SERIES = {
  meta: {
    symbol: "AAPL",
    interval: "1day",
    currency: "USD",
    exchange: "NASDAQ",
    mic_code: "XNGS",
    type: "Common Stock",
  },
  values: [
    {
      datetime: "2026-09-16",
      open: "332.525",
      high: "335.47",
      low: "331.945",
      close: "332.695",
      volume: "466780",
    },
    {
      datetime: "2026-09-15",
      open: "330.14001",
      high: "331.78000",
      low: "328.35001",
      close: "331.34000",
      volume: "31694100",
    },
  ],
  status: "ok",
};

export const AAPL_DIVIDENDS = {
  meta: {
    symbol: "AAPL",
    name: "Apple Inc.",
    currency: "USD",
    exchange: "NASDAQ",
    mic_code: "XNGS",
    exchange_timezone: "America/New_York",
  },
  dividends: [
    { ex_date: "2026-08-10", amount: 0.27 },
    { ex_date: "2026-05-11", amount: 0.27 },
  ],
};

export const AAPL_PROFILE = {
  symbol: "AAPL",
  name: "Apple Inc.",
  exchange: "NASDAQ",
  mic_code: "XNGS",
  sector: "Technology",
  industry: "Consumer Electronics",
  employees: 150000,
  website: "https://www.apple.com",
  description:
    "Apple Inc. is a technology company that designs, manufactures, and markets consumer electronics.",
  type: "Common Stock",
  CEO: "Mr. John  Ternus",
  country: "United States",
};

export const SEARCH_RESULTS = {
  data: [
    {
      symbol: "NORDLAS.B",
      instrument_name: "Nordlas AB",
      exchange: "OMX",
      mic_code: "XSTO",
      exchange_timezone: "Europe/Stockholm",
      instrument_type: "Common Stock",
      country: "Sweden",
      currency: "SEK",
    },
    {
      symbol: "THAMES",
      instrument_name: "Thames Holdings plc",
      exchange: "LSE",
      mic_code: "XLON",
      exchange_timezone: "Europe/London",
      instrument_type: "Common Stock",
      country: "United Kingdom",
      currency: "GBp",
    },
    {
      symbol: "NORDLASF",
      instrument_name: "Nordlas AB",
      exchange: "OTC",
      mic_code: "PINX",
      exchange_timezone: "America/New_York",
      instrument_type: "Common Stock",
      country: "United States",
      currency: "USD",
    },
    {
      symbol: "VOO",
      instrument_name: "Vanguard S&P 500 ETF",
      exchange: "NYSE",
      mic_code: "ARCX",
      exchange_timezone: "America/New_York",
      instrument_type: "ETF",
      country: "United States",
      currency: "USD",
    },
  ],
  status: "ok",
};

export const ERROR_ENDPOINT_PLAN = {
  code: 403,
  message:
    "/dividends is available exclusively with grow or pro or ultra or venture or enterprise plans. Consider upgrading your API Key now at https://twelvedata.com/pricing",
  status: "error",
};

export const ERROR_SYMBOL_PLAN = {
  code: 404,
  message:
    "This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing",
  status: "error",
};

export const ERROR_INVALID_SYMBOL = {
  code: 404,
  message:
    "**symbol** or **figi** parameter is missing or invalid. Please provide a valid symbol according to API documentation: https://twelvedata.com/docs#reference-data",
  status: "error",
};

export const ERROR_BAD_KEY = {
  code: 401,
  message:
    "**apikey** parameter is incorrect or not specified. You can get your free API key instantly following this link: https://twelvedata.com/pricing. If you believe that everything is correct, you can contact us at https://twelvedata.com/contact/customer",
  status: "error",
};

export const ERROR_MINUTE_LIMIT = {
  code: 429,
  message:
    "You have run out of API credits for the current minute. 9 API credits were used, with the current limit being 8. Wait for the next minute or consider switching to a higher tier plan at https://twelvedata.com/pricing",
  status: "error",
};

export const ERROR_DAILY_LIMIT = {
  code: 429,
  message:
    "You have run out of API credits for the day. 801 API credits were used, with the current limit being 800. Wait for the next day or consider switching to a higher tier plan at https://twelvedata.com/pricing",
  status: "error",
};

export const ERROR_NO_DATA = {
  code: 400,
  message: "No data is available on the specified dates. Try setting different start/end dates.",
  status: "error",
};
