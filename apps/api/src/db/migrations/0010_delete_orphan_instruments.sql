-- Custom SQL migration file, put your code below! --
DELETE FROM "instrument" i
WHERE NOT EXISTS (SELECT 1 FROM "transaction" t WHERE t."instrument_symbol" = i."symbol")
  AND NOT EXISTS (SELECT 1 FROM "dividend_history" d WHERE d."symbol" = i."symbol");
