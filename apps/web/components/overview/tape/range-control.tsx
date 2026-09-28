"use client";

import { Button, SegmentedControl } from "@sage/ui";
import type { RangeKey } from "../../../lib/income-tape/ranges";

export function RangeControl({
  active,
  year,
  bounds,
  onPick,
  onStepYear,
}: {
  active: RangeKey | null;
  year: number;
  bounds: { min: number; max: number };
  onPick: (key: RangeKey) => void;
  onStepYear: (delta: -1 | 1) => void;
}) {
  return (
    // Scrolls rather than wrapping on a phone — the holdings sort pattern.
    <div className="-mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1">
      <SegmentedControl
        size="sm"
        value={active ?? ""}
        onChange={(v) => onPick(v as RangeKey)}
        options={[
          { value: "today", label: "Today" },
          { value: "year", label: String(year) },
          { value: "ytd", label: "Year to date" },
          { value: "all", label: "All time" },
        ]}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label="Previous year"
        disabled={year <= bounds.min}
        onClick={() => onStepYear(-1)}
      >
        ‹
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Next year"
        disabled={year >= bounds.max}
        onClick={() => onStepYear(1)}
      >
        ›
      </Button>
    </div>
  );
}
