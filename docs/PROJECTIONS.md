# How Sage projects dividends

Every forward-looking dividend figure in Sage is arithmetic on your current
holdings and their payment history. None of it is a forecast in the sense of a
view on the market, and none of it is advice (see the
[disclaimer](./DISCLAIMER.md)). This page says what the arithmetic is, so you
can judge how far to trust each number.

## The next 12 months

The forward income on the overview, the analytics page's "next 12 months" and
the first year of the dividends calendar all come from one forecast, running
one year from today. For each holding you own today:

1. **Announced dividends** come first, as declared by the provider: amount, ex-date
   and, where known, payment date.
2. **After those, Sage continues the payer's schedule.** It infers the cadence (monthly,
   quarterly, semi-annual, annual) from the provider's reported period or from
   the spacing of past payments, and repeats the current regular amount at that
   cadence. Special (one-off) distributions are left out. The payment date is the
   ex-date plus the holding's usual delay between the two.
3. **An irregular payer** repeats each of its last 12 months' payments one year
   later, and is marked low confidence.
4. **A custom holding with income settings** (a savings account, for example) follows the
   schedule and yearly percentage you entered, on today's balance and price.

Nothing is grown in this window. Amounts are today's.

## Further out: the dividends calendar

The calendar also covers the next three full calendar years. Past the 12-month
forecast it keeps the same schedules, and it changes one thing: **each
holding's dividend grows at a yearly rate**, stepping up once on each
anniversary of today. So the first year always matches the 12-month forecast
above, and later years rise (or fall) from there.

These payments assume **your holdings stay exactly as they are today**: no new
purchases, no sales, no reinvested dividends. For reinvestment and regular
contributions, use the Goal page. Custom holdings are not grown. Their
percentage is your own setting, and it stays as you set it.

In the calendar, a payment in this range is marked "long range", and its details
say which yearly rate was applied.

## The growth rate, and why it is capped at 10%

A holding's yearly rate starts from its **5-year dividend CAGR**. Sage splits
the last five years into 12-month periods counted back from today, totals the
dividends per share in each, and takes the compound growth from the earliest
complete period to the latest. A period is complete when it holds as many
payments as the payer's current cadence (four for a quarterly payer), so a
half-year of payments never counts as a cut. Two adjustments turn that historical
figure into the rate Sage carries forward:

- **It is capped at 10% a year.**
- **It is floored at 0%** if you turn off _Allow negative dividend growth_ in
  Settings. With the setting on (the default), a shrinking dividend keeps
  shrinking at its own rate.

A holding with too little history for a 5-year rate gets no growth at all.

The Goal page's default dividend growth uses the same per-holding rates,
averaged by forward income, so the two pages always agree.

### Why the cap

A 5-year CAGR is a true statement about the past and a poor prediction of the
future, because it depends entirely on where the five years start. The cases
that break it are common:

- **A dividend restarted after a suspension.** A company that paid nothing for
  a year or two and then rebuilt its payout measures its growth from that
  restart, which can easily read as 50% a year.
- **A dividend recovering from a cut or a trough.** Measured from the low point,
  the recovery reads as growth, often 30% a year or more.
- **A genuine but exceptional grower.** A company that raises its payout
  five-fold in five years really did grow about 50% a year, and is still very
  unlikely to keep doing so.

Compounded over the calendar's three years, 50% a year multiplies a dividend by
3.4. One such holding can make the later years say more about its past than
about your portfolio. The 10% ceiling is a judgment, not a measurement: it sits
at the high end of what dividend growers tend to sustain over long periods, so
a real grower stays visibly ahead of a stagnant one without a base-year
accident driving the projection.

The cap is shown, not hidden: a capped payment says "capped; its 5-year rate is
…" next to the rate used.

The cap applies only to rates carried forward. Historical growth shown as a
statistic, such as the growth figures on the analytics page, is the uncapped
5-year CAGR, because as a description of the past it is accurate.

### What this does not fix

A capped or uncapped rate is still an extrapolation. Dividends get cut, and a
rate measured over good years says nothing about the next bad one. Treat the
calendar's later years as "what today's book would pay if each payer kept
roughly its recent course", not as expected income.
