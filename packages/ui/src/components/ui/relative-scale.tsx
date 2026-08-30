import { cn } from "../../lib/utils";

// Real portfolios sit further from the market than a first guess suggests: a
// dividend book measured against the S&P 500 produced a beta of 0.43 and a
// drawdown 2.8x the index's, all three of which a [0.5x, 2x] domain clamped to
// the edges. Two doublings either side of parity keeps ordinary portfolios on
// the scale and reserves clamping for genuine outliers.
const MIN_RATIO = 0.25;
const MAX_RATIO = 4;

/** Where a ratio sits along the track, 0 (left) to 1 (right), with the
 *  benchmark at 0.5.
 *
 *  The axis is log2 so that half the benchmark and twice the benchmark are
 *  equidistant from centre. On a linear axis every value below parity would be
 *  squashed into the left quarter, which would make "a bit less volatile" and
 *  "far less volatile" look nearly identical.
 *
 *  Ratios outside [0.5x, 2x] — and any non-finite or non-positive ratio, which
 *  log2 cannot place — clamp to the nearest end and report `clamped` so the
 *  caller can mark the marker rather than quietly lying about its position. */
export function scalePosition(ratio: number): { position: number; clamped: boolean } {
  if (!Number.isFinite(ratio) || ratio <= 0) return { position: 0, clamped: true };
  if (ratio <= MIN_RATIO) return { position: 0, clamped: ratio < MIN_RATIO };
  if (ratio >= MAX_RATIO) return { position: 1, clamped: ratio > MAX_RATIO };
  const span = Math.log2(MAX_RATIO) - Math.log2(MIN_RATIO);
  return { position: (Math.log2(ratio) - Math.log2(MIN_RATIO)) / span, clamped: false };
}

export interface RelativeScaleProps {
  /** The portfolio figure over the benchmark figure. 1 is level with it. */
  ratio: number;
  /** Benchmark the centre pin stands for, e.g. "S&P 500". */
  pinLabel: string;
  /** Sentence read in place of the graphic. Say what the position means, not
   *  what it looks like. */
  srLabel: string;
  className?: string;
}

/** A hairline track with the benchmark pinned at centre and the portfolio
 *  marked at its position. Deliberately colourless: position states a fact,
 *  and colour would state a verdict Sage has no business giving. */
export function RelativeScale({ ratio, pinLabel, srLabel, className }: RelativeScaleProps) {
  const { position, clamped } = scalePosition(ratio);
  return (
    <div role="img" aria-label={srLabel} className={cn("mt-2 w-full", className)}>
      {/* The track is a data mark, not chrome, so it takes a muted-foreground
          tint rather than a hairline: at 7% alpha the line was invisible
          against a card wash, which left the marker floating on nothing. */}
      <div className="relative h-px w-full bg-muted-foreground/25">
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/70"
        />
        <span
          aria-hidden
          data-clamped={clamped ? "true" : undefined}
          style={{ left: `${position * 100}%` }}
          className={cn(
            "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground",
            clamped && "rounded-none [clip-path:polygon(0_0,100%_50%,0_100%)]",
          )}
        />
      </div>
      <div className="label-caps mt-2 text-center text-muted-foreground">{pinLabel}</div>
    </div>
  );
}
