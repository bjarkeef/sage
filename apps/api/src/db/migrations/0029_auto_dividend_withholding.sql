-- Dividend rows the auto-reconciler created carried no `fee`, and a dividend
-- row's `fee` is the tax withheld before the cash landed. Zero there does not
-- mean "unknown", it means "none was taken" — which is never true of a real
-- payment. Imported rows have always carried the broker's real figure: 34.6%
-- across the reporting book's 158 of them, against 0% on its 26 auto rows.
--
-- With income about to be reported net, that split would have bent the trend
-- line at the point where a book stopped importing and started reconciling —
-- recent income taxed at nothing, older income taxed at a third — for a reason
-- that is an artefact of provenance rather than anything that happened.
--
-- So the estimate is written where the observation is missing, at the rate the
-- user declared. It is an estimate, and `source = 'auto'` already says so: a
-- later import that supersedes one of these brings the broker's real number
-- with it.
--
-- Only NULL fees are touched. A row that already carries one is either an
-- import or a run of the corrected reconciler, and both are better answers
-- than this arithmetic.
UPDATE "transaction" AS t
SET "fee" = ROUND(t."quantity" * t."price" * u."dividend_tax_rate" / 100, 10),
    "fee_currency" = t."currency"
FROM "portfolio" AS p, "user" AS u
WHERE t."portfolio_id" = p."id"
  AND p."user_id" = u."id"
  AND t."type" = 'dividend'
  AND t."source" = 'auto'
  AND t."fee" IS NULL
  AND u."dividend_tax_rate" IS NOT NULL
  AND u."dividend_tax_rate" > 0;
