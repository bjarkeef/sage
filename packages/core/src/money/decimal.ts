import D from "decimal.js";

/**
 * The single Sage decimal engine. A configured decimal.js constructor used
 * everywhere precision matters (money, and later quantities/prices/FX/percent).
 *
 * `precision` bounds only inexact operations (division, roots); addition,
 * subtraction and multiplication stay exact.
 */
export const Decimal = D.clone({
  precision: 34,
  rounding: D.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** An instance of the configured Sage decimal engine. */
export type Decimal = InstanceType<typeof Decimal>;

/** Supported rounding strategies, mapped to decimal.js constants below. */
export type RoundingMode = "half-even" | "half-up" | "half-down" | "up" | "down" | "ceil" | "floor";

/** Maps Sage rounding names to decimal.js rounding-mode constants. */
export const ROUNDING_MODES: Record<RoundingMode, D.Rounding> = {
  "half-even": 6,
  "half-up": 4,
  "half-down": 5,
  up: 0,
  down: 1,
  ceil: 2,
  floor: 3,
};

/** The default rounding strategy (banker's rounding). */
export const DEFAULT_ROUNDING: RoundingMode = "half-even";
