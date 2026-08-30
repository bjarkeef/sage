import { describe, it, expect } from "vitest";
import { eodhdToAppSymbol, appSymbolToEodhd } from "./exchange-map";

describe("eodhdToAppSymbol", () => {
  it("returns the bare code for US listings", () => {
    expect(eodhdToAppSymbol("AAPL", "US")).toBe("AAPL");
  });
  it("maps XETRA to the .DE suffix", () => {
    expect(eodhdToAppSymbol("EUDIV", "XETRA")).toBe("EUDIV.DE");
  });
  it("maps LSE to the .L suffix", () => {
    expect(eodhdToAppSymbol("THAMES", "LSE")).toBe("THAMES.L");
  });
  it("maps Stuttgart (STU) to the .SG suffix", () => {
    expect(eodhdToAppSymbol("NECKAR", "STU")).toBe("NECKAR.SG");
  });
  it("falls back to the raw exchange code when unmapped", () => {
    expect(eodhdToAppSymbol("FOO", "WAR")).toBe("FOO.WAR");
  });
});

describe("appSymbolToEodhd", () => {
  it("appends .US to bare codes", () => {
    expect(appSymbolToEodhd("AAPL")).toBe("AAPL.US");
  });
  it("translates .DE to .XETRA", () => {
    expect(appSymbolToEodhd("EUDIV.DE")).toBe("EUDIV.XETRA");
  });
  it("translates .L to .LSE", () => {
    expect(appSymbolToEodhd("THAMES.L")).toBe("THAMES.LSE");
  });
  it("translates .CO to .CO (identity suffixes preserved)", () => {
    expect(appSymbolToEodhd("KOBANK.CO")).toBe("KOBANK.CO");
  });
  it("passes unknown suffixes through unchanged", () => {
    expect(appSymbolToEodhd("FOO.WAR")).toBe("FOO.WAR");
  });
  it("keeps hyphens in codes intact", () => {
    expect(appSymbolToEodhd("ZED-B")).toBe("ZED-B.US");
  });
});
