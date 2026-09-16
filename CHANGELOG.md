# Changelog

Notable changes to Sage. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sage was developed in private and its history was rewritten before publication,
so there is no commit-by-commit record from before this release. The log starts
here.

## [1.0.0-beta.2] - 2026-09-16

A walkthrough of a clean install, and a second pass over the numbers against a
real book. If you installed beta.1, this is the release to be on.

### Your first import

- A freshly imported book shows the dividends it has received straight away.
  Before, the first page you opened spent the once-a-day dividend
  reconciliation on an empty book, so an import showed almost no received
  income for a day, and the overview printed a full forward year against that
  as growth.
- The first import sets your display currency to the one most of your book is
  in, and says so. A mixed-currency book with none set used to disagree with
  itself: one page guessed USD, others showed dashes.
- New holdings say "Fetching prices" while their first prices arrive, instead
  of announcing that prices are unavailable.
- Sector and country data heal on their own. A profile that failed to load at
  import, or has gone a week without refreshing, is fetched again in the
  background, so an `Unknown` slice no longer stays forever.
- A broker's interest row now replaces the payment Sage generated for the same
  custom holding and date, instead of landing next to it and counting twice.

### The front page leads with income

- The overview opens with what the book will pay over the next twelve months,
  and every payment it has received or expects on one axis: paid, confirmed and
  estimated, fading as it moves into the future. Portfolio value moved below it.
- The monthly rhythm is a ring against an even-year reference, so a lumpy year
  is something you see.

### Numbers

- Benchmarks are total-return indexes. Comparing a portfolio that includes
  dividends against price-only indexes flattered every book: by 1.4 percentage
  points against the S&P 500 over the year it was measured.
- Trading fees are part of cost basis. They were recorded and never used.
- Realised gains from sales are computed, and total return covers the whole
  life of the book, not only what is still held.
- A reconciled dividend carries withholding tax like an imported one.
- A settled close beats an intraday print from the same session, so the total
  stops moving while the market is shut.
- A chart window no longer opens on a day nothing traded, which had left most
  holdings unpriced on its first point for YTD and 3M.
- A holding whose price history stopped is still counted, at its last price,
  and the page names it and the date. The notice now says when only the chart
  history is old and today's value uses a current price.
- Gains read in both money and percent.

### Removed

- The money-weighted return. Its arithmetic was right, but without a cash
  account it reads moving money between holdings as withdrawals and deposits,
  which can put it far from the time-weighted return for no real reason. It can
  come back if Sage gets a cash model.

### Smaller

- Diversification opens with funds x-rayed into their sectors.
- An invalid query parameter is a 400 error, not a 500.
- Labels on Diversification are no longer clipped to a few characters.

## [1.0.0-beta.1] - 2026-09-10

First public release.

### Portfolio and holdings

- One row per position with daily change, total return, weight and yield,
  sortable in place.
- Custom holdings for instruments no provider covers, priced by you, so a book
  with something unlisted in it still adds up.
- A page per instrument: price history, your position in it, profile,
  fundamentals, dividend history, news and analyst ratings.

### Dividends

- A calendar showing one year at a time, with received and predicted payments in
  the same grid. Payment certainty is encoded in three tones - paid, confirmed,
  estimated - and a date Sage predicted rather than the company declaring is
  marked separately from an amount Sage forecast.
- Analytics: forward twelve-month run rate, per-payer and per-month breakdowns,
  income by year, and dividend growth rates.
- Positions you have since sold stay in the history, because income you actually
  received should not disappear because you exited.
- A total that would span more than one currency renders as a dash rather than a
  figure that is wrong in every currency you might read it as.

### Performance

- Time-weighted return chained daily over the range you pick, annualized past a
  year, beside a money-weighted XIRR.
- Volatility, beta, maximum drawdown, best and worst day, and benchmark lines.
- A reconciliation banner when stored price history disagrees with your own
  transactions, naming the holdings and adjusting nothing.

### Diversification and categories

- Weights by sector, country, region, asset class and currency, on market value
  or on what you paid.
- An X-Ray toggle that looks through funds and ETFs to their underlying
  holdings instead of counting each fund as one line.
- Anything Sage cannot classify goes to an `Unknown` bucket in plain sight
  rather than being spread across the ones it can.

### Getting your book in

- A forgiving CSV importer: it guesses the columns, shows you the parsed rows
  before committing, and lists what it could not read with a reason. Reads
  `$1,241.30`, `1.241,30`, `1 241,30` and `1'241.30` as the same number, and
  flags ambiguous dates rather than guessing.
- Broker transaction words are mapped, with anything left over offered as a
  dropdown rather than a file to go and edit.
- Re-importing an overlapping file is safe: every row carries a hash and the
  ones already recorded are recognised as duplicates.
- A dedicated Snowball Analytics reader, and single-holding entry for a handful
  of positions.

### Corporate actions

- A read-only audit trail of what Sage did with splits and what it declined to
  do, printing its own coverage so a cold price store cannot read as confidence.

### Privacy and self-hosting

- Web app, API and Postgres come up together under one `docker compose up`.
  There is no Sage server.
- Company logos and news thumbnails are off by default, because both would name
  what you hold to a third party. With both unset, nothing does.
- Prices and ECB reference rates are stored in your own database as they arrive,
  so a provider outage leaves you with the last known values and a notice rather
  than an empty app.
- Export your transactions as CSV or everything as JSON at any time, with no
  provider calls involved.
- Account recovery from a shell (`sage reset-password`), because Sage sends no
  email.

### Known limitations

- **Market data is not licensed.** The default price source is an unofficial
  Yahoo client: broad coverage, no key, and it can break without warning - it
  did on 2026-08-09. Official providers are supported, but their free tiers are
  small enough that most setups still fall back.
  See [`docs/MARKET-DATA.md`](./docs/MARKET-DATA.md).
- Sage has no tax-residency model. One dividend tax rate applies to every
  holding.
- There is no offline cache in the installable phone app, deliberately: stale
  figures are worse than none in an app whose value is that its numbers are
  current.
- Sage records and measures; it does not advise. See
  [`docs/DISCLAIMER.md`](./docs/DISCLAIMER.md).

[1.0.0-beta.2]: https://github.com/bjarkeef/sage/releases/tag/v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/bjarkeef/sage/releases/tag/v1.0.0-beta.1
