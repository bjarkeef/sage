/** Base class for portfolio-domain errors. */
export class PortfolioError extends Error {}

/** Thrown when a sell consumes more shares than are held for a symbol. */
export class OversellError extends PortfolioError {
  constructor(readonly symbol: string) {
    super(`Sell exceeds held quantity for ${symbol}`);
    this.name = "OversellError";
  }
}
