"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Upload, SunMoon, type LucideIcon } from "lucide-react";
import { getPortfolio, searchInstruments } from "../lib/api";
import { formatMoney } from "../lib/format";
import { navItems } from "../lib/nav";
import type { PositionDTO, SearchResultDTO } from "../lib/types";
import { CompanyLogo } from "./company-logo";

type PaletteItem =
  | { kind: "page"; label: string; href: string; icon: LucideIcon }
  | { kind: "holding"; position: PositionDTO }
  | { kind: "instrument"; result: SearchResultDTO }
  | { kind: "action"; label: string; icon: LucideIcon; run: () => void };

interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

const MAX_HOLDINGS = 5;

function assetHref(symbol: string, exchange: string): string {
  const slug = exchange ? `${exchange}-${symbol}` : symbol;
  return `/asset/${encodeURIComponent(slug)}`;
}

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [positions, setPositions] = React.useState<PositionDTO[]>([]);
  const [instruments, setInstruments] = React.useState<SearchResultDTO[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setInstruments([]);
      setSelectedIndex(0);
      getPortfolio()
        .then((p) => setPositions(p.positions))
        .catch(() => setPositions([]));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  React.useEffect(() => {
    if (query.length < 2) {
      setInstruments([]);
      return;
    }
    const timeout = setTimeout(() => {
      searchInstruments(query)
        .then((r) => setInstruments(r.slice(0, 6)))
        .catch(() => setInstruments([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const groups = React.useMemo<PaletteGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: string[]) =>
      q === "" || fields.some((f) => f.toLowerCase().includes(q));

    const pages: PaletteItem[] = navItems
      .filter((n) => match(n.label))
      .map((n) => ({ kind: "page", label: n.label, href: n.href, icon: n.icon }));

    const holdings: PaletteItem[] = positions
      .filter((p) => match(p.symbol, p.name))
      .slice(0, MAX_HOLDINGS)
      .map((p) => ({ kind: "holding", position: p }));

    const heldSymbols = new Set(positions.map((p) => p.symbol));
    const found: PaletteItem[] = instruments
      .filter((r) => !heldSymbols.has(r.symbol))
      .map((r) => ({ kind: "instrument", result: r }));

    const actions: PaletteItem[] = (
      [
        {
          kind: "action" as const,
          label: "Import transactions",
          icon: Upload,
          run: () => router.push("/import"),
        },
        {
          kind: "action" as const,
          label: "Toggle theme",
          icon: SunMoon,
          run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
        },
      ] as PaletteItem[]
    ).filter((a) => a.kind === "action" && match(a.label));

    const result: PaletteGroup[] = [];
    if (holdings.length > 0) result.push({ label: "Holdings", items: holdings });
    if (pages.length > 0) result.push({ label: "Pages", items: pages });
    if (found.length > 0) result.push({ label: "Instruments", items: found });
    if (actions.length > 0) result.push({ label: "Actions", items: actions });
    return result;
  }, [query, positions, instruments, router, setTheme, resolvedTheme]);

  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query, positions.length, instruments.length]);

  function activate(item: PaletteItem) {
    if (item.kind === "page") router.push(item.href);
    else if (item.kind === "holding")
      router.push(assetHref(item.position.symbol, item.position.exchange));
    else if (item.kind === "instrument")
      router.push(assetHref(item.result.symbol, item.result.exchange));
    else item.run();
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[selectedIndex]) {
      e.preventDefault();
      activate(flat[selectedIndex]);
    }
  }

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-card border border-hairline bg-popover shadow-md">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <svg
            className="h-4 w-4 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search assets, pages, actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="rounded-badge border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            ESC
          </kbd>
        </div>

        {flat.length > 0 ? (
          <div className="max-h-[360px] divide-y divide-hairline overflow-auto">
            {groups.map((group) => (
              <div key={group.label} className="p-1.5">
                <div className="label-caps px-2.5 pb-1 pt-1.5 text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const selected = index === selectedIndex;
                  const rowClass = `flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left text-sm transition-colors ${
                    selected ? "bg-surface-active" : "hover:bg-surface-hover"
                  }`;
                  if (item.kind === "holding" || item.kind === "instrument") {
                    const symbol =
                      item.kind === "holding" ? item.position.symbol : item.result.symbol;
                    const name = item.kind === "holding" ? item.position.name : item.result.name;
                    const website = item.kind === "holding" ? item.position.website : null;
                    const exchange =
                      item.kind === "holding" ? item.position.exchange : item.result.exchange;
                    const trailing =
                      item.kind === "holding"
                        ? item.position.marketValue
                          ? formatMoney(item.position.marketValue)
                          : null
                        : item.result.exchange;
                    return (
                      <button
                        key={`${item.kind}-${exchange}-${symbol}`}
                        type="button"
                        onClick={() => activate(item)}
                        className={rowClass}
                      >
                        <CompanyLogo website={website} symbol={symbol} size={22} />
                        <span className="font-mono text-data font-medium">{symbol}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {name}
                        </span>
                        {trailing && (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {trailing}
                          </span>
                        )}
                      </button>
                    );
                  }
                  const Icon = item.icon;
                  return (
                    <button
                      key={`${item.kind}-${item.label}`}
                      type="button"
                      onClick={() => activate(item)}
                      className={rowClass}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="flex-1">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query.length >= 2 ? `No results for "${query}"` : "Type to search your portfolio"}
          </div>
        )}
      </div>
    </div>
  );
}
