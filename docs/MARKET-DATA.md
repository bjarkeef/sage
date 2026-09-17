# Market data

Sage does not have a licensed market-data feed. This document sets out exactly
what it uses instead, what that costs you, and what you see when it fails.

What it has instead is a default that works and some official alternatives
whose free tiers are small. Being straight about that is the point of this
document.

**The default is Yahoo, and it is unofficial.** With no API key set, Sage reads
prices through [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2),
an unofficial client for endpoints Yahoo does not publish as a public API. It has
broad coverage and costs nothing, and it can break without warning — it did on
2026-08-09, when an upstream change blanked every price in the app. Yahoo's terms
of service govern what you may do with that data; personal self-hosting is the
case Sage is built for, and if you have anything commercial in mind you should
read those terms yourself rather than take this document's word for it.

**The licensed options are official, and their free tiers are small.**

| Provider                                      | Free tier                 | Notes                                                        |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------ |
| [EODHD](https://eodhd.com/pricing)            | 20 API calls/day          | Prices 1 call each; fundamentals are paywalled               |
| [Twelve Data](https://twelvedata.com/pricing) | 8 credits/minute, 800/day | Free plan is US prices only; see [Twelve Data](#twelve-data) |
| ECB (FX only)                                 | unrationed                | Official euro reference rates, no key                        |

Twenty calls a day does not cover the first load of a thirty-holding portfolio,
because each symbol needs its own quote. Sage handles this by falling back to
Yahoo whenever the primary provider cannot serve a symbol — which means that in
practice, **a free-tier setup still leans on the unofficial path**, and adding a
key does not by itself change that.

On EODHD's free tier the fundamentals endpoint is paywalled outright, so company
profile data (sector, market cap, P/E) will not come from it; Sage degrades
around this rather than failing. Enrichment (`ENRICHMENT_PROVIDER`, default
`yahoo`) accepts `yahoo`, which fills those gaps from the unofficial path even
when your prices come from EODHD.

## Twelve Data

Set `MARKET_DATA_PROVIDER=twelvedata`, `TWELVEDATA_API_KEY`, and
`TWELVEDATA_CREDITS_PER_MINUTE` to your plan's per-minute credits (free 8,
Grow 55, Pro 610). Sage never sends more than that in a minute: once the
minute's credits are spent, requests go straight to Yahoo instead of queueing.

**What a key covers depends on its plan.** Checked against the live API on
2026-09-16; Twelve Data's own [pricing](https://twelvedata.com/pricing) is the
authority.

| Data                                                                      | Individual plan needed | Business plan needed |
| ------------------------------------------------------------------------- | ---------------------- | -------------------- |
| US quotes and daily history                                               | Basic (free)           | Venture              |
| Dividends, company profile                                                | Grow                   | Venture              |
| Germany, London, Euronext (Paris, Amsterdam, Brussels, Lisbon), Toronto   | Grow                   | Venture              |
| Copenhagen, Stockholm, Oslo, Helsinki, Milan, Madrid, SIX, ASX, Hong Kong | Pro                    | Venture              |

Anything your plan does not include is served by Yahoo, silently and by design:
the degraded-prices notice does not report it, because a plan declining an
exchange is not an outage. A free key on a mostly European portfolio therefore
still leans almost entirely on the unofficial path.

Market cap, P/E, beta, dividend yield and ETF composition are not read from
Twelve Data; with `ENRICHMENT_PROVIDER=yahoo` they come from Yahoo as before.

**Licensing.** Twelve Data's individual plans are for personal, internal,
non-commercial use. Running Sage for yourself on your own key fits that. Showing
the data to other people — a hosted service — needs a business plan; the
Venture plan is the one that grants external display.

**What you see when data is unavailable.** Prices are stored in your own
Postgres, so an outage or an exhausted quota does not empty the app. You keep
seeing the last known values, with a notice naming the age and the cause
("Prices last updated 2 days ago — EODHD has spent its daily allowance"). A
symbol that has _never_ been fetched has nothing to show and will read as
unavailable until a provider answers for it. Currency conversion is unaffected:
ECB rates are stored locally too, and are neither rate-limited nor tied to your
market-data provider.

**Region comes from the country name.** Diversification's region breakdown is
derived from a two-letter country code. Yahoo and Twelve Data report a country
name, which Sage maps to a code from a table of the names those providers
actually return; a name it does not recognise stays `Unknown` rather than
guessing, because a wrong region is worse than an absent one.
