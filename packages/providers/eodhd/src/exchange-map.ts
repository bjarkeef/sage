// EODHD exchange code -> Yahoo-style app-symbol suffix ("" = bare US code).
// The app stores and requests Yahoo-format symbols because every provider in
// the fallback chain can resolve those.
const EODHD_TO_SUFFIX: Record<string, string> = {
  US: "",
  LSE: "L",
  XETRA: "DE",
  F: "F",
  STU: "SG",
  PA: "PA",
  AS: "AS",
  BR: "BR",
  LS: "LS",
  MI: "MI",
  MC: "MC",
  SW: "SW",
  ST: "ST",
  CO: "CO",
  OL: "OL",
  HE: "HE",
  TO: "TO",
  V: "V",
  AU: "AX",
  HK: "HK",
  SI: "SI",
};

const SUFFIX_TO_EODHD: Record<string, string> = Object.fromEntries(
  Object.entries(EODHD_TO_SUFFIX)
    .filter(([, suffix]) => suffix !== "")
    .map(([exchange, suffix]) => [suffix, exchange]),
);

/** Convert an EODHD code+exchange pair to the app-wide (Yahoo-style) symbol. */
export function eodhdToAppSymbol(code: string, exchange: string): string {
  const suffix = EODHD_TO_SUFFIX[exchange];
  if (suffix === "") return code;
  return `${code}.${suffix ?? exchange}`;
}

/** Convert an app-wide symbol to EODHD request format (CODE.EXCHANGE). */
export function appSymbolToEodhd(symbol: string, defaultExchange = "US"): string {
  const at = symbol.lastIndexOf(".");
  if (at === -1) return `${symbol}.${defaultExchange}`;
  const code = symbol.slice(0, at);
  const suffix = symbol.slice(at + 1);
  return `${code}.${SUFFIX_TO_EODHD[suffix] ?? suffix}`;
}
