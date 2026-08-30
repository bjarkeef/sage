"use client";
import { Button } from "@sage/ui";
import { InstrumentSearch } from "./instrument-search";
import { CompanyLogo } from "./company-logo";
import type { SearchResultDTO } from "../lib/types";

export interface InstrumentPickerProps {
  instrument: SearchResultDTO | null;
  /** The caller already knows the holding (asset page, holdings row). Renders
   *  the identity only — no search box exists to mis-pick, and no way to
   *  change it, because changing it was never the point of that entry. */
  locked?: boolean;
  /** Threaded down to the search input so the caller's <label for> binds to
   *  a real control instead of naming nothing. Unused once an instrument is
   *  chosen — that view has no labelable control at all. */
  id?: string;
  onSelect?: (r: SearchResultDTO) => void;
  onClear?: () => void;
}

/** The dialog's Holding control: search, or the instrument you already chose. */
export function InstrumentPicker({
  instrument,
  locked = false,
  id,
  onSelect,
  onClear,
}: InstrumentPickerProps) {
  if (!instrument) {
    return <InstrumentSearch id={id} onSelect={(r) => onSelect?.(r)} />;
  }

  return (
    <div className="flex items-center gap-3 rounded-control bg-surface-active px-3 py-2">
      <CompanyLogo website={null} symbol={instrument.symbol} size={28} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{instrument.symbol}</div>
        <div className="truncate text-xs text-muted-foreground">{instrument.name}</div>
      </div>
      <span className="ml-auto font-mono text-xs text-muted-foreground">{instrument.currency}</span>
      {!locked && (
        <Button variant="ghost" size="sm" onClick={() => onClear?.()}>
          Change
        </Button>
      )}
    </div>
  );
}
