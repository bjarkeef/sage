import { describe, it, expect } from "vitest";
import { parseEurofxrefXml } from "./parse";

/** Shape of eurofxref-daily.xml — note SINGLE-quoted attributes. */
const DAILY = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<gesmes:subject>Reference rates</gesmes:subject>
<Cube><Cube time='2026-08-07'>
<Cube currency='USD' rate='1.1535'/>
<Cube currency='DKK' rate='7.4756'/>
<Cube currency='EUR' rate='1.0000'/>
</Cube></Cube></gesmes:Envelope>`;

/** Shape of eurofxref-hist.xml — note DOUBLE-quoted attributes. */
const HIST = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<Cube><Cube time="2026-08-07"><Cube currency="USD" rate="1.1535"/></Cube>
<Cube time="2026-08-06"><Cube currency="USD" rate="1.1600"/><Cube currency="GBP" rate="0.85765"/></Cube>
</Cube></gesmes:Envelope>`;

describe("parseEurofxrefXml", () => {
  it("parses single-quoted attributes (daily feed)", () => {
    const days = parseEurofxrefXml(DAILY);
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe("2026-08-07");
    expect(days[0]!.ratesPerEur.get("USD")!.toFixed(4)).toBe("1.1535");
    expect(days[0]!.ratesPerEur.get("DKK")!.toFixed(4)).toBe("7.4756");
  });

  it("parses double-quoted attributes (history feed)", () => {
    const days = parseEurofxrefXml(HIST);
    expect(days).toHaveLength(2);
    expect(days[0]!.ratesPerEur.get("USD")!.toFixed(4)).toBe("1.1535");
    expect(days[1]!.date).toBe("2026-08-06");
    expect(days[1]!.ratesPerEur.get("GBP")!.toFixed(5)).toBe("0.85765");
  });

  it("never emits EUR as a quote currency", () => {
    // DAILY includes an explicit <Cube currency='EUR' rate='1.0000'/> entry
    // (ECB's real feeds omit EUR entirely) so this test actually exercises
    // the currency === "EUR" guard in parse.ts, rather than passing vacuously
    // because the fixture never contained EUR in the first place.
    const days = parseEurofxrefXml(DAILY);
    expect(days[0]!.ratesPerEur.has("EUR")).toBe(false);
    expect(days[0]!.ratesPerEur.get("USD")!.toFixed(4)).toBe("1.1535");
    expect(days[0]!.ratesPerEur.get("DKK")!.toFixed(4)).toBe("7.4756");
  });

  it("skips entries with a non-numeric rate (ECB emits 'N/A' on gaps)", () => {
    const xml = HIST.replace('rate="1.1600"', 'rate="N/A"');
    const days = parseEurofxrefXml(xml);
    expect(days[1]!.ratesPerEur.has("USD")).toBe(false);
    expect(days[1]!.ratesPerEur.get("GBP")!.toFixed(5)).toBe("0.85765");
  });

  it("returns an empty array for malformed or empty input", () => {
    expect(parseEurofxrefXml("")).toEqual([]);
    expect(parseEurofxrefXml("<html>503 Service Unavailable</html>")).toEqual([]);
  });
});
