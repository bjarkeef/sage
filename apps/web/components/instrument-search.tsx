"use client";
import * as React from "react";
import { Input } from "@sage/ui";
import { searchInstruments } from "../lib/api";
import type { SearchResultDTO } from "../lib/types";

export function InstrumentSearch({
  id,
  onSelect,
}: {
  id?: string;
  onSelect: (r: SearchResultDTO) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResultDTO[]>([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      searchInstruments(q)
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setOpen(true);
          }
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      clearTimeout(handle);
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="relative">
      <Input
        id={id}
        placeholder="Search ticker or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-control border border-input bg-background shadow-md">
          {results.map((r) => (
            <li key={`${r.symbol}-${r.exchange}`}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onSelect(r);
                  setQuery(`${r.symbol} — ${r.name}`);
                  setOpen(false);
                }}
              >
                <span className="font-medium">
                  {r.symbol} <span className="text-muted-foreground">· {r.exchange}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.name} ({r.currency})
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
