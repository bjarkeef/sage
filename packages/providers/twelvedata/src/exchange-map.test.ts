import { describe, it, expect } from "vitest";
import { SymbolNotFoundError } from "@sage/provider-interface";
import {
  appSymbolToTwelveData,
  twelveDataToAppSymbol,
  listingKey,
  listingParams,
} from "./exchange-map";

/**
 * Twelve Data names a listing by ticker plus ISO 10383 MIC, where Sage stores
 * Yahoo-style suffixes. The pairs below were checked against /symbol_search and
 * /exchanges on 2026-09-16 with real companies; the fixtures here are fictional
 * listings with the same shapes.
 */
describe("appSymbolToTwelveData", () => {
  it.each([
    ["AAPL", "AAPL", null],
    ["EUDIV.DE", "EUDIV", "XETR"],
    ["THAMES.L", "THAMES", "XLON"],
    ["SEINE.PA", "SEINE", "XPAR"],
    ["TULIP.AS", "TULIP", "XAMS"],
    ["MANNEKEN.BR", "MANNEKEN", "XBRU"],
    ["TEJO.LS", "TEJO", "XLIS"],
    ["DUOMO.MI", "DUOMO", "XMIL"],
    ["PRADO.MC", "PRADO", "XMAD"],
    ["ALPINE.SW", "ALPINE", "XSWX"],
    ["KOBANK.CO", "KOBANK", "XCSE"],
    ["SVEAFAST.ST", "SVEAFAST", "XSTO"],
    ["FJORD.OL", "FJORD", "XOSL"],
    ["SAUNA.HE", "SAUNA", "XHEL"],
    ["MAPLE.TO", "MAPLE", "XTSE"],
    ["KOALA.AX", "KOALA", "XASX"],
    ["HARBOUR.HK", "HARBOUR", "XHKG"],
  ])("maps %s to %s on %s", (app, symbol, micCode) => {
    expect(appSymbolToTwelveData(app)).toEqual({ symbol, micCode });
  });

  it("writes a share class with a dot, as Twelve Data does on every venue", () => {
    expect(appSymbolToTwelveData("NORDLAS-B.ST")).toEqual({ symbol: "NORDLAS.B", micCode: "XSTO" });
    expect(appSymbolToTwelveData("ZED-B")).toEqual({ symbol: "ZED.B", micCode: null });
  });

  it("refuses a suffix it cannot place, so the fallback serves it", () => {
    expect(() => appSymbolToTwelveData("FOO.WAR")).toThrow(SymbolNotFoundError);
  });

  it.each(["^GSPC", "EURUSD=X"])(
    "refuses %s, an index or FX symbol Twelve Data never serves, before any request",
    (app) => {
      expect(() => appSymbolToTwelveData(app)).toThrow(SymbolNotFoundError);
    },
  );
});

describe("twelveDataToAppSymbol", () => {
  it.each(["XNYS", "XNAS", "XNGS", "XNCM", "XNMS", "ARCX", "BATS", "XASE", "IEXG"])(
    "treats %s as a bare US listing",
    (mic) => {
      expect(twelveDataToAppSymbol("AAPL", mic)).toBe("AAPL");
    },
  );

  it("adds the Yahoo suffix and turns a class dot back into a hyphen", () => {
    expect(twelveDataToAppSymbol("NORDLAS.B", "XSTO")).toBe("NORDLAS-B.ST");
    expect(twelveDataToAppSymbol("ZED.B", "XNYS")).toBe("ZED-B");
    expect(twelveDataToAppSymbol("THAMES", "XLON")).toBe("THAMES.L");
  });

  it("round-trips every mapped suffix", () => {
    for (const app of ["EUDIV.DE", "KOBANK.CO", "HARBOUR.HK", "NORDLAS-B.ST"]) {
      const listing = appSymbolToTwelveData(app);
      expect(twelveDataToAppSymbol(listing.symbol, listing.micCode!)).toBe(app);
    }
  });

  it("returns null for a MIC Sage has no suffix for", () => {
    expect(twelveDataToAppSymbol("THAMES", "PINX")).toBeNull();
  });
});

describe("listingKey and listingParams", () => {
  it("names a listing by symbol and MIC, or by symbol alone for the US", () => {
    expect(listingKey({ symbol: "EUDIV", micCode: "XETR" })).toBe("EUDIV@XETR");
    expect(listingKey({ symbol: "AAPL", micCode: null })).toBe("AAPL");
  });

  it("sends mic_code only when there is one", () => {
    expect(listingParams({ symbol: "EUDIV", micCode: "XETR" })).toEqual({
      symbol: "EUDIV",
      mic_code: "XETR",
    });
    expect(listingParams({ symbol: "AAPL", micCode: null })).toEqual({ symbol: "AAPL" });
  });
});
