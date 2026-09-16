import { SymbolNotFoundError } from "@sage/provider-interface";

/**
 * Sage stores Yahoo-style symbols (`EUDIV.DE`); Twelve Data names a listing by
 * ticker plus ISO 10383 MIC (`EUDIV` on `XETR`). Checked against /symbol_search
 * and /exchanges on 2026-09-16: tickers match Yahoo's on every venue here —
 * Hong Kong keeps its leading zeros — except that a share class is written with
 * a dot where Yahoo uses a hyphen.
 */
const SUFFIX_TO_MIC: Record<string, string> = {
  DE: "XETR",
  L: "XLON",
  PA: "XPAR",
  AS: "XAMS",
  BR: "XBRU",
  LS: "XLIS",
  MI: "XMIL",
  MC: "XMAD",
  SW: "XSWX",
  CO: "XCSE",
  ST: "XSTO",
  OL: "XOSL",
  HE: "XHEL",
  TO: "XTSE",
  AX: "XASX",
  HK: "XHKG",
};

const MIC_TO_SUFFIX: Record<string, string> = Object.fromEntries(
  Object.entries(SUFFIX_TO_MIC).map(([suffix, mic]) => [mic, suffix]),
);

/** US venues. A listing on any of them is a bare Yahoo symbol. */
const US_MICS = new Set(["XNYS", "XNAS", "XNGS", "XNCM", "XNMS", "ARCX", "BATS", "XASE", "IEXG"]);

export interface TwelveDataListing {
  symbol: string;
  /** null for a US listing: Twelve Data resolves a bare US ticker unaided. */
  micCode: string | null;
}

export function appSymbolToTwelveData(appSymbol: string): TwelveDataListing {
  const at = appSymbol.lastIndexOf(".");
  if (at === -1) return { symbol: appSymbol.replace(/-/g, "."), micCode: null };
  const mic = SUFFIX_TO_MIC[appSymbol.slice(at + 1)];
  if (!mic) throw new SymbolNotFoundError(appSymbol);
  return { symbol: appSymbol.slice(0, at).replace(/-/g, "."), micCode: mic };
}

export function twelveDataToAppSymbol(symbol: string, micCode: string): string | null {
  const code = symbol.replace(/\./g, "-");
  if (US_MICS.has(micCode)) return code;
  const suffix = MIC_TO_SUFFIX[micCode];
  return suffix ? `${code}.${suffix}` : null;
}

export function listingKey(listing: TwelveDataListing): string {
  return listing.micCode ? `${listing.symbol}@${listing.micCode}` : listing.symbol;
}

export function listingParams(listing: TwelveDataListing): Record<string, string> {
  return listing.micCode
    ? { symbol: listing.symbol, mic_code: listing.micCode }
    : { symbol: listing.symbol };
}
