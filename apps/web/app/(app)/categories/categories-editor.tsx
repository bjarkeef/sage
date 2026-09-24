"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import {
  Button,
  Card,
  CardTitle,
  Chip,
  cn,
  EmptyState,
  Input,
  PageHeader,
  PageShell,
} from "@sage/ui";
import { saveCategories } from "../../../lib/api";
import { invalidateFor } from "../../../lib/query/invalidation";
import { qk } from "../../../lib/query/keys";
import type {
  CategoriesViewDTO,
  CategoryNodeDTO,
  SaveCategoriesInput,
  SaveCategoryInput,
} from "../../../lib/types";

const selectClass = "h-9 rounded-control border border-border bg-transparent px-2 text-sm";

interface EditorHolding {
  symbol: string;
  /** Target share of the category holding it; blank means unset. */
  targetPct: string;
}

interface EditorCategory {
  /** Stable React key AND the identity used for parent links, so a category
   *  created in this session can be a parent before it has a server id. */
  key: string;
  id?: string;
  name: string;
  targetPct: string;
  parentKey: string | null;
  holdings: EditorHolding[];
}

/** Flatten the served tree into the editor's parent-pointer list. Sibling
 *  order is preserved by appending depth-first, which is also the order the
 *  save walks back into a nested payload. */
function flattenTree(nodes: CategoryNodeDTO[], parentKey: string | null): EditorCategory[] {
  return nodes.flatMap((node) => [
    {
      key: node.id,
      id: node.id,
      name: node.name,
      targetPct: node.targetPct != null ? String(node.targetPct) : "",
      parentKey,
      holdings: node.holdings.map((h) => ({
        symbol: h.symbol,
        targetPct: h.targetPct != null ? String(h.targetPct) : "",
      })),
    },
    ...flattenTree(node.children, node.id),
  ]);
}

function collectNames(node: CategoryNodeDTO, into: Map<string, string>): void {
  for (const h of node.holdings) into.set(h.symbol, h.name);
  for (const c of node.children) collectNames(c, into);
}

/** Depth-first display order plus each row's depth, so the list reads as the
 *  tree it is. */
function ordered(categories: EditorCategory[]): { category: EditorCategory; depth: number }[] {
  const out: { category: EditorCategory; depth: number }[] = [];
  const walk = (parentKey: string | null, depth: number) => {
    for (const category of categories.filter((c) => c.parentKey === parentKey)) {
      out.push({ category, depth });
      walk(category.key, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function descendantKeys(categories: EditorCategory[], key: string): Set<string> {
  const out = new Set<string>();
  const walk = (parentKey: string) => {
    for (const c of categories) {
      if (c.parentKey === parentKey && !out.has(c.key)) {
        out.add(c.key);
        walk(c.key);
      }
    }
  };
  walk(key);
  return out;
}

/** A typed target percentage; "12,5" reads as 12.5. */
const pct = (v: string): number => Number(normalizeDecimalInput(v));

export function CategoriesEditor({
  data,
  displayCurrency,
  onClose,
}: {
  data: CategoriesViewDTO;
  displayCurrency: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Flat symbol -> name lookup across every holding in the tree
  const nameBySymbol = React.useMemo(() => {
    const m = new Map<string, string>();
    collectNames(data.root, m);
    for (const h of data.unallocated) m.set(h.symbol, h.name);
    return m;
  }, [data]);

  const newKeySeq = React.useRef(0);
  const [categories, setCategories] = React.useState<EditorCategory[]>(() =>
    flattenTree(data.root.children, null),
  );
  const [rootHoldings, setRootHoldings] = React.useState<EditorHolding[]>(() =>
    data.root.holdings.map((h) => ({
      symbol: h.symbol,
      targetPct: h.targetPct != null ? String(h.targetPct) : "",
    })),
  );
  const [selectedKey, setSelectedKey] = React.useState<string | null>(
    () => flattenTree(data.root.children, null)[0]?.key ?? null,
  );
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const nameInputRefs = React.useRef<Record<string, HTMLInputElement | null>>({});
  const focusNameKey = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (focusNameKey.current != null) {
      nameInputRefs.current[focusNameKey.current]?.focus();
      focusNameKey.current = null;
    }
  }, [categories.length]);

  const placed = new Set([
    ...categories.flatMap((c) => c.holdings.map((h) => h.symbol)),
    ...rootHoldings.map((h) => h.symbol),
  ]);
  const tray = [...nameBySymbol.keys()].filter((s) => !placed.has(s));

  function assign(symbol: string) {
    if (selectedKey == null) return;
    setCategories((cs) =>
      cs.map((c) =>
        c.key === selectedKey ? { ...c, holdings: [...c.holdings, { symbol, targetPct: "" }] } : c,
      ),
    );
  }

  function remove(symbol: string) {
    setCategories((cs) =>
      cs.map((c) => ({ ...c, holdings: c.holdings.filter((h) => h.symbol !== symbol) })),
    );
    setRootHoldings((hs) => hs.filter((h) => h.symbol !== symbol));
  }

  function addCategory() {
    const key = `new-${newKeySeq.current++}`;
    setCategories((cs) => [...cs, { key, name: "", targetPct: "", parentKey: null, holdings: [] }]);
    setSelectedKey(key);
    focusNameKey.current = key;
  }

  /** Deleting promotes the children one level rather than taking the subtree
   *  with them, and returns the holdings to the tray. The database cascade
   *  would delete everything below, which is more than one click should do. */
  function deleteCategory(key: string) {
    setCategories((cs) => {
      const target = cs.find((c) => c.key === key);
      if (!target) return cs;
      return cs
        .filter((c) => c.key !== key)
        .map((c) => (c.parentKey === key ? { ...c, parentKey: target.parentKey } : c));
    });
    setSelectedKey((current) => (current === key ? null : current));
  }

  function reparent(key: string, parentKey: string | null) {
    setCategories((cs) => cs.map((c) => (c.key === key ? { ...c, parentKey } : c)));
  }

  function makeRootHolding(symbol: string) {
    setRootHoldings((hs) => [...hs, { symbol, targetPct: "" }]);
  }

  function rename(key: string, name: string) {
    setCategories((cs) => cs.map((c) => (c.key === key ? { ...c, name } : c)));
  }

  function retarget(key: string, targetPct: string) {
    setCategories((cs) => cs.map((c) => (c.key === key ? { ...c, targetPct } : c)));
  }

  function retargetHolding(categoryKey: string, symbol: string, targetPct: string) {
    setCategories((cs) =>
      cs.map((c) =>
        c.key === categoryKey
          ? {
              ...c,
              holdings: c.holdings.map((h) => (h.symbol === symbol ? { ...h, targetPct } : h)),
            }
          : c,
      ),
    );
  }

  function retargetRootHolding(symbol: string, targetPct: string) {
    setRootHoldings((hs) => hs.map((h) => (h.symbol === symbol ? { ...h, targetPct } : h)));
  }

  // Only root-level targets are shares of the PORTFOLIO, so only they belong
  // in a headline that is compared against 100. A nested category's target is
  // a share of its parent and would be meaningless added in here.
  // Include negative targets so a stray minus sign shows up instead of being
  // silently ignored (the server rejects them on save).
  const targetSum = [
    ...categories.filter((c) => c.parentKey === null).map((c) => pct(c.targetPct)),
    ...rootHoldings.map((h) => pct(h.targetPct)),
  ]
    .filter((n) => Number.isFinite(n) && n !== 0)
    .reduce((s, n) => s + n, 0);

  const num = (v: string): number | null => (v.trim() === "" ? null : pct(v));

  function buildTree(parentKey: string | null): SaveCategoryInput[] {
    return categories
      .filter((c) => c.parentKey === parentKey)
      .map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        name: c.name,
        targetPct: num(c.targetPct),
        holdings: c.holdings.map((h) => ({ symbol: h.symbol, targetPct: num(h.targetPct) })),
        children: buildTree(c.key),
      }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const input: SaveCategoriesInput = {
      categories: buildTree(null),
      rootHoldings: rootHoldings
        .filter((h) => h.targetPct.trim() !== "")
        .map((h) => ({ symbol: h.symbol, targetPct: pct(h.targetPct) })),
    };
    try {
      const fresh = await saveCategories(input, displayCurrency ?? undefined);
      qc.setQueryData(qk.categoriesView(displayCurrency), fresh);
      await invalidateFor(qc, "categories");
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      setSaving(false);
    }
  }

  const rows = ordered(categories);

  return (
    <PageShell>
      <PageHeader
        title="Edit categories"
        description="Group your holdings, nest categories, and set target allocations."
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <span
              className={cn(
                "font-mono text-data tabular-nums",
                targetSum > 100 ? "text-loss" : "text-muted-foreground",
              )}
            >
              {targetSum.toFixed(1)}% targeted
            </span>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              Save
            </Button>
          </div>
        }
      />

      {saveError && (
        <p role="alert" className="mb-5 text-sm text-loss">
          {saveError}
        </p>
      )}

      <Card className="mb-5">
        <CardTitle meta={`${tray.length} unassigned`}>Tray</CardTitle>
        {tray.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {tray.map((symbol) => (
              <div key={symbol} className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Assign ${symbol} to selected category`}
                  onClick={() => assign(symbol)}
                  disabled={selectedKey == null}
                >
                  {symbol}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Set standalone target for ${symbol}`}
                  onClick={() => makeRootHolding(symbol)}
                >
                  Standalone
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">All holdings are assigned.</p>
        )}
        {selectedKey == null && categories.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Select a category first.</p>
        )}
        {categories.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Add a category first.</p>
        )}
      </Card>

      <div className="space-y-5">
        {rows.map(({ category, depth }) => {
          const forbidden = descendantKeys(categories, category.key);
          return (
            <div key={category.key} style={{ marginLeft: `${Math.min(depth, 4) * 20}px` }}>
              <Card
                role="button"
                tabIndex={0}
                aria-pressed={category.key === selectedKey}
                className={cn(
                  "cursor-pointer",
                  category.key === selectedKey && "ring-1 ring-primary",
                )}
                onClick={() => setSelectedKey(category.key)}
                onKeyDown={(e) => {
                  // Only act when the Card itself is focused — never for keydowns
                  // bubbling up from nested inputs/buttons (e.g. typing a space
                  // into the name field must not select the card and swallow it).
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    if (e.key === " ") e.preventDefault();
                    setSelectedKey(category.key);
                  }
                }}
              >
                <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                  <Input
                    ref={(el) => {
                      nameInputRefs.current[category.key] = el;
                    }}
                    value={category.name}
                    placeholder="Category name"
                    onChange={(e) => rename(category.key, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="max-w-xs"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Inside
                      <select
                        aria-label={`Parent of ${category.name || "new category"}`}
                        value={category.parentKey ?? ""}
                        className={selectClass}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => reparent(category.key, e.target.value || null)}
                      >
                        <option value="">Portfolio</option>
                        {categories
                          .filter((c) => c.key !== category.key && !forbidden.has(c.key))
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name || "Untitled"}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-1">
                      <Input
                        inputMode="decimal"
                        aria-label={`Target for ${category.name || "new category"}`}
                        value={category.targetPct}
                        placeholder="—"
                        onChange={(e) => retarget(category.key, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-16 text-right font-mono text-data tabular-nums"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${category.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCategory(category.key);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {category.holdings.length > 0 ? (
                  <div className="space-y-1">
                    {category.holdings.map((holding) => (
                      <div
                        key={holding.symbol}
                        className="flex flex-wrap items-center gap-2 rounded-control bg-surface-active px-2 py-1.5"
                      >
                        <Chip>{holding.symbol}</Chip>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {nameBySymbol.get(holding.symbol) ?? holding.symbol}
                        </span>
                        <Input
                          inputMode="decimal"
                          aria-label={`Target for ${holding.symbol} in ${category.name || "this category"}`}
                          value={holding.targetPct}
                          placeholder="—"
                          onChange={(e) =>
                            retargetHolding(category.key, holding.symbol, e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="w-16 text-right font-mono text-data tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${holding.symbol}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(holding.symbol);
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No holdings assigned yet.</p>
                )}
              </Card>
            </div>
          );
        })}
      </div>

      <Button variant="outline" className="mt-5" onClick={addCategory}>
        Add category
      </Button>

      {rootHoldings.length > 0 && (
        <Card className="mt-5">
          <CardTitle>Standalone targets</CardTitle>
          <div className="space-y-2">
            {rootHoldings.map((h) => (
              <div key={h.symbol} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm">{nameBySymbol.get(h.symbol) ?? h.symbol}</span>
                <div className="flex items-center gap-2">
                  <Input
                    inputMode="decimal"
                    aria-label={`Target for ${h.symbol}`}
                    value={h.targetPct}
                    placeholder="0"
                    onChange={(e) => retargetRootHolding(h.symbol, e.target.value)}
                    className="w-16 text-right font-mono text-data tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${h.symbol}`}
                    onClick={() => remove(h.symbol)}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {categories.length === 0 && rootHoldings.length === 0 && tray.length === 0 && (
        <EmptyState className="mt-5" message="No holdings to categorize yet." />
      )}
    </PageShell>
  );
}
