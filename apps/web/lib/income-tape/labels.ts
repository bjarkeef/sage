export const LABEL_LINE_PX = 14;
const PAD_PX = 8;
const CHAR_PX = 7; // 11px Geist Mono advance with 0.12em tracking
const GAP_PX = 4;
const MAX_SLOTS = 6;

export interface LabelCandidate {
  key: string;
  x: number;
  /** Top of the bar (or its ghost, whichever is taller) the label points at. */
  anchorTop: number;
  lines: string[];
}

export interface PlacedLabel {
  key: string;
  x: number;
  top: number;
  width: number;
  height: number;
  lines: string[];
  anchorTop: number;
}

/** Greedy placement in the caller's priority order (largest payment first):
 *  each label takes the lowest free slot above its bar, stacking upward, and is
 *  dropped if every slot under `minTop` is taken. Never overlaps. */
export function placeLabels(candidates: LabelCandidate[], minTop: number): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const c of candidates) {
    const width = Math.max(5, ...c.lines.map((l) => l.length)) * CHAR_PX + 12;
    const height = c.lines.length * LABEL_LINE_PX + PAD_PX;
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      const top = c.anchorTop - 6 - height - slot * (height + GAP_PX);
      if (top < minTop) break;
      const clash = placed.some(
        (o) =>
          c.x - width / 2 < o.x + o.width / 2 &&
          c.x + width / 2 > o.x - o.width / 2 &&
          top < o.top + o.height &&
          top + height > o.top,
      );
      if (!clash) {
        placed.push({
          key: c.key,
          x: c.x,
          top,
          width,
          height,
          lines: c.lines,
          anchorTop: c.anchorTop,
        });
        break;
      }
    }
  }
  return placed;
}
