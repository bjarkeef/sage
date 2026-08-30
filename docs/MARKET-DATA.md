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

| Provider                           | Free tier        | Notes                                          |
| ---------------------------------- | ---------------- | ---------------------------------------------- |
| [EODHD](https://eodhd.com/pricing) | 20 API calls/day | Prices 1 call each; fundamentals are paywalled |
| ECB (FX only)                      | unrationed       | Official euro reference rates, no key          |

Twenty calls a day does not cover the first load of a thirty-holding portfolio,
because each symbol needs its own quote. Sage handles this by falling back to
Yahoo whenever the primary provider cannot serve a symbol — which means that in
practice, **a free-tier setup still leans on the unofficial path**, and adding a
key does not by itself change that.

On EODHD's free tier the fundamentals endpoint is paywalled outright, so company
profile data (sector, market cap, P/E) will not come from it; Sage degrades
around this rather than failing. Optional enrichment (`ENRICHMENT_PROVIDER`,
default `none`) accepts `yahoo`, which fills those gaps from the unofficial
path even when your prices come from EODHD.

**What you see when data is unavailable.** Prices are stored in your own
Postgres, so an outage or an exhausted quota does not empty the app. You keep
seeing the last known values, with a notice naming the age and the cause
("Prices last updated 2 days ago — EODHD has spent its daily allowance"). A
symbol that has _never_ been fetched has nothing to show and will read as
unavailable until a provider answers for it. Currency conversion is unaffected:
ECB rates are stored locally too, and are neither rate-limited nor tied to your
market-data provider.

**Region is a gap on the default path, and it shows.** Diversification's region
breakdown is derived from a two-letter country code on the instrument profile.
The Yahoo path never fills that field — it returns a country _name_ and no ISO
code — so on a default setup every holding resolves to `Unknown` and the region
panel reads `Unknown 100%`. EODHD does supply the code, but only from the
fundamentals endpoint its free tier paywalls. The panel is left visible and
labelled rather than quietly removed, on the same principle as the `Unknown`
bucket everywhere else: a gap you can see is a gap, and one that has been
hidden reads as a claim.
