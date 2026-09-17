/**
 * Requires every exchange-suffixed symbol literal to be on an approved list.
 *
 * Why this exists: the Snowball importer, the dividend engine and the exchange
 * maps were all built against a real broker export, and its symbols were pasted
 * in as test data. By 2026-08 they had spread to two dozen files — including a
 * docblock in `packages/core` — and together they described one person's
 * portfolio, in a repo about to go public. They were replaced with fictional
 * equivalents on 2026-08-16.
 *
 * Why an allowlist rather than a denylist of the old symbols: a denylist would
 * have to spell those symbols out, which reprints in one file exactly what the
 * sweep spread across twenty — and it would not catch the *next* export
 * somebody pastes in, which will name different holdings. An allowlist is
 * silent about what was removed and still fails on anything new.
 *
 * Scope, stated honestly: this checks symbols carrying an exchange suffix
 * (`.CO`, `.ST`, `.L`, `.DE`, …), because that is the shape a European broker
 * export has and the shape every leaked symbol here had. A bare US-style
 * ticker (`AAPL`, `KO`) is not checked — there is no way to tell a holding from
 * the universal placeholders that finance codebases have always used, and the
 * placeholders reveal nothing. Adding a real bare ticker is still against the
 * convention in CLAUDE.md; it is just not machine-checkable.
 */

/**
 * Approved suffixed symbols. Everything here is fictional except where noted;
 * the names are chosen to say what the fixture is for, so `THAMES.L` tells the
 * reader the test is about the London suffix.
 *
 * Adding an entry is a deliberate act: invent a symbol, do not reach for a real
 * one you happen to hold.
 */
const ALLOWED = new Set([
  // Fictional listings, one per exchange suffix under test
  "0THAM.L", // leading digit, LSE depositary-line shape
  "ALBION.L",
  "ALPINE.SW",
  "BRITIDX.L",
  "BRITIDX.LSE",
  "DUOMO.MI",
  "EUDIV.DE",
  "EUDIV.XETRA",
  "FJORD.OL",
  "FRANKA.DE",
  "GLOBIX.XLON",
  "HARBOUR.HK",
  "KOALA.AX",
  "KOBANK.CO",
  "KRONIX.CO",
  "MANNEKEN.BR",
  "MAPLE.TO",
  "NECKAR.DE",
  "NECKAR.SG",
  "NORDLAS-B.ST",
  "NORDLAS.B", // Twelve Data's spelling of NORDLAS-B.ST: class after a dot
  "PRADO.MC",
  "RHEIN.DE",
  "SAUNA.HE",
  "SEINE.PA",
  "SVEAFAST.ST",
  "TEJO.LS",
  "THAMES.L",
  "THAMES.LSE",
  "TULIP.AS",
  "ZED-B.US",
  "ZED.B", // Twelve Data's spelling of a US class share, ZED-B
  // Explicit placeholders that already read as fake
  "BAR.DE",
  "EMPTY.US",
  "FAKE.US",
  "FOO.WAR",
  "FOO.XXXX",
  "NOPE.US",
  // Real, and load-bearing: universal placeholder in provider-format tests
  "AAPL.MX",
  "AAPL.US",
  // Real, and load-bearing: benchmark definitions in valuation-series.ts, and
  // the fixtures that seed them. These are product configuration, not fixtures
  // — a benchmark has to name the series it actually tracks. They reveal
  // nothing about anyone's holdings; every Sage instance uses the same two.
  //
  // Both must be TOTAL-RETURN series; see the `BENCHMARKS` doc comment for why
  // a price index cannot be compared to a portfolio TWR. The price-return
  // predecessors (`GSPC.INDX`, `URTH.US`) were retired on 2026-09-10 and are
  // deliberately NOT kept here: an allowlist entry with no call site is an
  // invitation to reintroduce the thing it used to permit.
  "SP500TR.INDX",
  "IWDA.L",
]);

/**
 * Two exemptions:
 *
 * - `yahoo.live.ts` and `twelvedata.live.ts` ask the real providers whether a
 *   symbol resolves, so an invented ticker would fail for the uninteresting
 *   reason that it does not exist. They are the files where real symbols are
 *   load-bearing, and neither is ever part of `pnpm test`.
 * - This rule and its test necessarily spell symbols out to describe them.
 */
const EXEMPT = /(?:(?:yahoo|twelvedata)\.live\.[cm]?tsx?|no-identifying-tickers(?:\.test)?\.js)$/;

/** Prose abbreviations that happen to look like a one-letter ticker with a
 *  suffix. Listed rather than excluded by length, so a genuine single-letter
 *  listing (`O.US`) is still checked. */
const NOT_SYMBOLS = new Set(["E.G", "I.E"]);

/** A symbol with an exchange suffix: `NORDA-B.CO`, `0THAM.L`, `EUDIV.XETRA`. */
const SUFFIXED = /^[0-9A-Z][0-9A-Z_-]{0,11}\.[A-Z]{1,5}$/;

/**
 * Scan free text for unapproved suffixed symbols.
 *
 * Tokenised rather than matched whole, because the symbols arrive inside larger
 * strings: a Snowball CSV fixture row is one long literal with the ticker in
 * the middle of it, and that is precisely the paste this rule is here to catch.
 * Splitting on everything that cannot occur in a symbol keeps `application/json`
 * and `2026-05-29` from being mistaken for one.
 */
function* offenders(text) {
  for (const raw of text.split(/[^0-9A-Za-z._-]+/)) {
    // Trim punctuation the split has to keep, because `.` and `-` are part of
    // a symbol: without this, a symbol ending a sentence ("shaped like X.DE.")
    // keeps the full stop and slips through.
    const word = raw.replace(/^[.\-_]+/, "").replace(/[.\-_]+$/, "");
    if (SUFFIXED.test(word) && !ALLOWED.has(word) && !NOT_SYMBOLS.has(word)) yield word;
  }
}

function report(context, node, text) {
  if (typeof text !== "string") return;
  for (const word of offenders(text)) {
    context.report({
      node,
      message:
        `"${word}" is an exchange-suffixed symbol that is not on the approved list. ` +
        `If it is a real ticker, replace it with a fictional one that keeps the shape ` +
        `under test — see CLAUDE.md. If it is already fictional, add it to ALLOWED in ` +
        `tooling/eslint-config/rules/no-identifying-tickers.js.`,
    });
  }
}

export default {
  meta: {
    type: "problem",
    docs: { description: "keep exchange-suffixed symbols fictional and approved" },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename() ?? "";
    if (EXEMPT.test(filename.replace(/\\/g, "/"))) return {};

    return {
      Literal(node) {
        report(context, node, node.value);
      },
      TemplateElement(node) {
        report(context, node, node.value.raw);
      },
      // Comments are checked too: the constant that started the sweep named a
      // real holding in a docblock, not in a fixture.
      Program(node) {
        const source = context.sourceCode ?? context.getSourceCode();
        for (const comment of source.getAllComments()) {
          for (const word of offenders(comment.value)) {
            context.report({
              node: comment.loc ? comment : node,
              message:
                `"${word}" is an exchange-suffixed symbol that is not on the approved ` +
                `list, and comments count. Describe the shape instead ("a ` +
                `Stockholm-listed monthly payer"), or add it to ALLOWED.`,
            });
          }
        }
      },
    };
  },
};
