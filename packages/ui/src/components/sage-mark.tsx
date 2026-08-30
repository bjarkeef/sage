export interface SageMarkProps {
  size?: number;
  /** The bowl. Defaults to `currentColor` so the mark inherits from its
   *  container — that is how the muted variants on the error pages work. */
  color?: string;
  /** The seed above the bowl. Falls back to `color`, giving a single-tone mark
   *  wherever a second colour would be noise. */
  accent?: string;
  className?: string;
}

/**
 * The Sage mark: a seed resting over an open bowl.
 *
 * Two filled shapes rather than the earlier stroked sprout. Strokes of 1.4 at a
 * 24px viewBox render at roughly one device pixel once the mark is drawn at its
 * real 19–22px, so the old sprout's leaves thinned to grey hairlines exactly
 * where it is used most — the sidebar. Solid shapes hold at any size, which is
 * also what makes the mark usable as a favicon.
 *
 * Geometry is taken from the repo teaser so the app, the site and the tab icon
 * are the same drawing.
 */
export function SageMark({ size = 22, color = "currentColor", accent, className }: SageMarkProps) {
  const a = accent ?? color;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M3.5 13.6a8.5 8.5 0 0 0 17 0Z" fill={color} />
      <circle cx="12" cy="6.6" r="2.7" fill={a} />
    </svg>
  );
}
