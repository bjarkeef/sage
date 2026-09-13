import { eq, inArray } from "drizzle-orm";
import { Decimal, computePositions, type PositionTransaction } from "@sage/core";
import {
  transaction,
  instrument,
  assetProfile,
  user,
  category,
  categoryAssignment,
} from "../db/schema";
import { getUserPortfolio } from "../auth";
import type { PortfolioViewDeps } from "./portfolio-view";
import type { Database } from "../db/client";
import { toPositionTransaction } from "../lib/to-position-transaction";
import { feeRateLookup } from "./portfolio-book";
import { getRatesWithProvenance } from "../market-data/fx-provenance";

export interface MoneyJSON {
  amount: string;
  currency: string;
}

/** The synthetic node id of the portfolio itself. Not a `category` row — the
 *  root is the portfolio, and it has no database identity. */
export const ROOT_ID = "root";

export interface HoldingItem {
  symbol: string;
  name: string;
  website: string | null;
  value: MoneyJSON;
  invested: MoneyJSON;
  gain: MoneyJSON;
  gainPercent: number | null;
  /** Share of the node this holding sits in, percent — not of the portfolio. */
  weightPct: number;
  /** Target share of the node this holding sits in; null when unset. */
  targetPct: number | null;
}

export interface CategoryNode {
  id: string;
  name: string;
  /** Share of the PARENT this node targets; null when unset. */
  targetPct: number | null;
  /** Share of the parent this node actually holds. */
  actualPct: number;
  /** Rolled up: this node's own holdings plus every descendant's. */
  value: MoneyJSON;
  invested: MoneyJSON;
  gain: MoneyJSON;
  gainPercent: number | null;
  children: CategoryNode[];
  /** Holdings assigned directly to this node, not to its children. */
  holdings: HoldingItem[];
  /** children.length + holdings.length — the "10 items" subtitle. */
  itemCount: number;
}

export interface Totals {
  value: MoneyJSON;
  invested: MoneyJSON;
  gain: MoneyJSON;
  gainPercent: number | null;
  /** Sum of the targets set at the ROOT level (root categories + root-level
   *  assets); null when none are set. Deeper levels each have their own sum,
   *  which the client computes from the node it is showing. */
  targetPctSum: number | null;
}

export interface CategoriesViewBody {
  /** The portfolio itself. Its `value` is the whole portfolio, including
   *  holdings in `unallocated` — so a child's `actualPct` is its share of
   *  everything, and the unallocated remainder is visible rather than
   *  quietly inflating every category. */
  root: CategoryNode;
  unallocated: HoldingItem[];
  totals: Totals;
  /** True when some held currency had no FX rate to the display currency —
   *  those values are passed through unconverted (labeled in the display
   *  currency); the client should surface this. */
  fxIncomplete: boolean;
  /** True when the stored ECB rates used for conversion are older than the
   *  staleness threshold — totals are approximate. Independent of
   *  `fxIncomplete`; both can be true. */
  fxStale: boolean;
  /** Publication date of the ECB rates used for conversion; null when no
   *  conversion was needed or no rates were stored. */
  fxRatesAsOf: string | null;
}

interface PricedHolding {
  symbol: string;
  name: string;
  website: string | null;
  value: Decimal; // in target currency
  invested: Decimal; // in target currency
}

interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  targetPct: string | null;
  position: number;
}

/** A node before it is rendered: money stays in `Decimal` so a parent can roll
 *  its children up without re-parsing formatted strings. */
interface RawNode {
  id: string;
  name: string;
  targetPct: number | null;
  value: Decimal;
  invested: Decimal;
  children: RawNode[];
  holdings: { holding: PricedHolding; targetPct: number | null }[];
}

const pct = (part: Decimal, whole: Decimal): number =>
  whole.isZero() ? 0 : Number(part.dividedBy(whole).times(100).toFixed(2));

/** Assemble the parent/child forest. A `parentId` that does not name another
 *  row in this portfolio is treated as root — and the `seen` set means a cycle
 *  in the stored data drops the offending edge instead of recursing forever.
 *  Neither is reachable through the API, which rejects both; this is the read
 *  path refusing to hang on data it did not write. */
function buildForest(
  rows: CategoryRow[],
  holdingsByCategory: Map<string, { holding: PricedHolding; targetPct: number | null }[]>,
): RawNode[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const parent = row.parentId != null && byId.has(row.parentId) ? row.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(row);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.position - b.position);

  const seen = new Set<string>();
  const build = (row: CategoryRow): RawNode => {
    seen.add(row.id);
    const children = (childrenOf.get(row.id) ?? []).filter((r) => !seen.has(r.id)).map(build);
    const holdings = (holdingsByCategory.get(row.id) ?? []).sort((a, b) =>
      b.holding.value.minus(a.holding.value).toNumber(),
    );
    const own = holdings.reduce(
      (acc, h) => ({
        value: acc.value.plus(h.holding.value),
        invested: acc.invested.plus(h.holding.invested),
      }),
      { value: new Decimal(0), invested: new Decimal(0) },
    );
    return {
      id: row.id,
      name: row.name,
      targetPct: row.targetPct != null ? Number(row.targetPct) : null,
      value: children.reduce((s, c) => s.plus(c.value), own.value),
      invested: children.reduce((s, c) => s.plus(c.invested), own.invested),
      children,
      holdings,
    };
  };
  return (childrenOf.get(null) ?? []).map(build);
}

export async function buildCategoriesView(
  deps: PortfolioViewDeps,
  userId: string,
  opts: { currency?: string | null },
): Promise<CategoriesViewBody> {
  const { db, provider, fxRateService } = deps;

  // Display currency: explicit ?currency, else user setting, else USD — the
  // same resolution diversification-view uses (percentages need one currency).
  let targetCurrency = opts.currency ?? null;
  if (!targetCurrency) {
    const [userRow] = await db
      .select({ displayCurrency: user.displayCurrency })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    targetCurrency = userRow?.displayCurrency ?? "USD";
  }
  const { id: portfolioId } = await getUserPortfolio(db, userId);

  // Three reads keyed on the same portfolio and on nothing from each other.
  const [rows, categoryRows, assignmentRows] = await Promise.all([
    db.select().from(transaction).where(eq(transaction.portfolioId, portfolioId)),
    db
      .select({
        id: category.id,
        parentId: category.parentId,
        name: category.name,
        targetPct: category.targetPct,
        position: category.position,
      })
      .from(category)
      .where(eq(category.portfolioId, portfolioId))
      .orderBy(category.position) as Promise<CategoryRow[]>,
    db.select().from(categoryAssignment).where(eq(categoryAssignment.portfolioId, portfolioId)),
  ]);
  // Same fee conversion the portfolio book applies, so a holding's cost is one
  // number wherever it is shown rather than two that differ by a fee.
  const feeRates = await feeRateLookup(db, rows);
  const txs: PositionTransaction[] = rows.map((r) => toPositionTransaction(r, feeRates));
  const positions = computePositions(txs);

  const empty = (): MoneyJSON => ({ amount: "0.00", currency: targetCurrency });
  const money = (d: Decimal): MoneyJSON => ({ amount: d.toFixed(2), currency: targetCurrency });

  /** Render a raw node against the value of the level it sits in. */
  const toNode = (raw: RawNode, parentValue: Decimal): CategoryNode => {
    const gain = raw.value.minus(raw.invested);
    return {
      id: raw.id,
      name: raw.name,
      targetPct: raw.targetPct,
      actualPct: pct(raw.value, parentValue),
      value: money(raw.value),
      invested: money(raw.invested),
      gain: money(gain),
      gainPercent: raw.invested.isZero() ? null : pct(gain, raw.invested),
      children: raw.children.map((c) => toNode(c, raw.value)),
      holdings: raw.holdings.map(({ holding, targetPct }) => {
        const hGain = holding.value.minus(holding.invested);
        return {
          symbol: holding.symbol,
          name: holding.name,
          website: holding.website,
          value: money(holding.value),
          invested: money(holding.invested),
          gain: money(hGain),
          gainPercent: holding.invested.isZero() ? null : pct(hGain, holding.invested),
          weightPct: pct(holding.value, raw.value),
          targetPct,
        };
      }),
      itemCount: raw.children.length + raw.holdings.length,
    };
  };

  if (positions.length === 0) {
    const forest = buildForest(categoryRows, new Map());
    const zero = new Decimal(0);
    const root: RawNode = {
      id: ROOT_ID,
      name: "Portfolio",
      targetPct: null,
      value: zero,
      invested: zero,
      children: forest,
      holdings: [],
    };
    return {
      root: { ...toNode(root, zero), actualPct: 100 },
      unallocated: [],
      totals: {
        value: empty(),
        invested: empty(),
        gain: empty(),
        gainPercent: null,
        targetPctSum: rootTargetSum(categoryRows, []),
      },
      fxIncomplete: false,
      fxStale: false,
      fxRatesAsOf: null,
    };
  }

  const heldSymbols = positions.map((p) => p.symbol);
  const [instrumentRows, profileRows] = await Promise.all([
    db.select().from(instrument).where(inArray(instrument.symbol, heldSymbols)),
    db
      .select({ symbol: assetProfile.symbol, website: assetProfile.website })
      .from(assetProfile)
      .where(inArray(assetProfile.symbol, heldSymbols)),
  ]);
  const nameBySymbol = new Map(instrumentRows.map((i) => [i.symbol, i.name]));
  const websiteBySymbol = new Map(profileRows.map((p) => [p.symbol, p.website]));

  // Live market values; cost basis when the quote fails (diversification-view convention).
  const valueBySymbol = new Map<string, Decimal>();
  await Promise.all(
    positions.map(async (pos) => {
      try {
        const quote = await provider.getQuote(pos.symbol);
        valueBySymbol.set(pos.symbol, quote.price.toDecimal().times(pos.quantity));
      } catch {
        valueBySymbol.set(pos.symbol, pos.costBasis.toDecimal());
      }
    }),
  );

  // FX: rates are target/source (getRates("USD", ["EUR"]) → 1 USD in EUR), so
  // converting source → target divides — same as diversification-view.
  const currencies = [...new Set(positions.map((p) => p.currency))];
  const fxRates = new Map<string, Decimal>();
  let fxStale = false;
  let fxRatesAsOf: string | null = null;
  if (fxRateService && currencies.some((cur) => cur !== targetCurrency)) {
    try {
      const { rates, stale, asOf } = await getRatesWithProvenance(
        fxRateService,
        targetCurrency,
        currencies.filter((cur) => cur !== targetCurrency),
      );
      for (const [ccy, rate] of rates) fxRates.set(ccy, rate);
      fxStale = stale;
      fxRatesAsOf = asOf;
    } catch {
      // FX unavailable — values pass through unconverted
    }
  }
  // A currency with no rate passes through UNCONVERTED while still being
  // labeled in the target currency — the same behavior as every other view
  // service (do not "fix" this here alone). The condition is surfaced to the
  // client via `fxIncomplete` below.
  const toTarget = (value: Decimal, fromCurrency: string): Decimal => {
    if (fromCurrency === targetCurrency) return value;
    const rate = fxRates.get(fromCurrency);
    if (!rate || rate.isZero()) return value;
    return value.dividedBy(rate);
  };
  const fxIncomplete = currencies.some((cur) => cur !== targetCurrency && !fxRates.has(cur));

  const priced = new Map<string, PricedHolding>();
  for (const pos of positions) {
    priced.set(pos.symbol, {
      symbol: pos.symbol,
      name: nameBySymbol.get(pos.symbol) ?? pos.symbol,
      website: websiteBySymbol.get(pos.symbol) ?? null,
      value: toTarget(valueBySymbol.get(pos.symbol) ?? new Decimal(0), pos.currency),
      invested: toTarget(pos.costBasis.toDecimal(), pos.currency),
    });
  }

  const totalValue = [...priced.values()].reduce((s, h) => s.plus(h.value), new Decimal(0));
  const totalInvested = [...priced.values()].reduce((s, h) => s.plus(h.invested), new Decimal(0));

  const holdingsByCategory = new Map<
    string,
    { holding: PricedHolding; targetPct: number | null }[]
  >();
  const rootHoldings: { holding: PricedHolding; targetPct: number | null }[] = [];
  const assignedSymbols = new Set<string>();
  for (const a of assignmentRows) {
    const holding = priced.get(a.symbol);
    if (!holding) continue; // assigned but not currently held (sold) — skip
    const targetPct = a.targetPct != null ? Number(a.targetPct) : null;
    assignedSymbols.add(a.symbol);
    if (a.categoryId != null) {
      const list = holdingsByCategory.get(a.categoryId) ?? [];
      list.push({ holding, targetPct });
      holdingsByCategory.set(a.categoryId, list);
    } else if (targetPct != null) {
      rootHoldings.push({ holding, targetPct });
    } else {
      // categoryId null with no target is meaningless and never written; treat
      // it as unallocated rather than inventing a root holding for it.
      assignedSymbols.delete(a.symbol);
    }
  }
  rootHoldings.sort((a, b) => b.holding.value.minus(a.holding.value).toNumber());

  const rawRoot: RawNode = {
    id: ROOT_ID,
    name: "Portfolio",
    targetPct: null,
    // The portfolio's value is everything held, unallocated included — see
    // `CategoriesViewBody.root`.
    value: totalValue,
    invested: totalInvested,
    children: buildForest(categoryRows, holdingsByCategory),
    holdings: rootHoldings,
  };

  const unallocated: HoldingItem[] = [...priced.values()]
    .filter((h) => !assignedSymbols.has(h.symbol))
    .sort((a, b) => b.value.minus(a.value).toNumber())
    .map((h) => {
      const gain = h.value.minus(h.invested);
      return {
        symbol: h.symbol,
        name: h.name,
        website: h.website,
        value: money(h.value),
        invested: money(h.invested),
        gain: money(gain),
        gainPercent: h.invested.isZero() ? null : pct(gain, h.invested),
        weightPct: pct(h.value, totalValue),
        targetPct: null,
      };
    });

  const totalGain = totalValue.minus(totalInvested);
  return {
    root: { ...toNode(rawRoot, totalValue), actualPct: 100 },
    unallocated,
    totals: {
      value: money(totalValue),
      invested: money(totalInvested),
      gain: money(totalGain),
      gainPercent: totalInvested.isZero() ? null : pct(totalGain, totalInvested),
      targetPctSum: rootTargetSum(categoryRows, rootHoldings),
    },
    fxIncomplete,
    fxStale,
    fxRatesAsOf,
  };
}

function rootTargetSum(
  categoryRows: CategoryRow[],
  rootHoldings: { targetPct: number | null }[],
): number | null {
  let sum = 0;
  let any = false;
  for (const c of categoryRows) {
    if (c.parentId != null) continue; // a nested target is a share of its parent, not of the portfolio
    if (c.targetPct != null) {
      sum += Number(c.targetPct);
      any = true;
    }
  }
  for (const t of rootHoldings) {
    if (t.targetPct != null) {
      sum += t.targetPct;
      any = true;
    }
  }
  return any ? Number(sum.toFixed(2)) : null;
}

export interface SaveCategoryInput {
  id?: string;
  name: string;
  targetPct: number | null;
  holdings: { symbol: string; targetPct?: number | null }[];
  children?: SaveCategoryInput[];
}

export interface SaveCategoriesInput {
  /** Root-level categories, nested. */
  categories: SaveCategoryInput[];
  /** Holdings sitting at the root with a target of their own. */
  rootHoldings: { symbol: string; targetPct: number }[];
}

export class CategoriesValidationError extends Error {}
export class CategoryNotFoundError extends Error {}

const validTarget = (t: number | null | undefined): boolean =>
  t == null || (Number.isFinite(t) && t >= 0 && t <= 100);

interface FlatCategory {
  input: SaveCategoryInput;
  parentIndex: number | null;
  position: number;
}

/** Depth-first flatten, parents before children, so an insert can always
 *  resolve its parent's id from a row already written. */
function flatten(categories: SaveCategoryInput[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (list: SaveCategoryInput[], parentIndex: number | null) => {
    list.forEach((input, position) => {
      const index = out.length;
      out.push({ input, parentIndex, position });
      walk(input.children ?? [], index);
    });
  };
  walk(categories, null);
  return out;
}

/** Replace the portfolio's whole category structure in one transaction.
 *  Symbols not in `heldSymbols` are dropped silently (spec §4/§6): a holding
 *  sold between page load and save must not fail the save. */
export async function replaceCategories(
  db: Database,
  portfolioId: string,
  heldSymbols: Set<string>,
  input: SaveCategoriesInput,
): Promise<void> {
  const flat = flatten(input.categories);

  for (const { input: c } of flat) {
    if (c.name.trim().length === 0) {
      throw new CategoriesValidationError("category name must not be empty");
    }
    if (!validTarget(c.targetPct)) throw new CategoriesValidationError("targetPct must be 0-100");
    for (const h of c.holdings) {
      if (!validTarget(h.targetPct)) throw new CategoriesValidationError("targetPct must be 0-100");
    }
  }

  // A nested payload cannot express a cycle — except by naming the same
  // existing category in two places, which would leave the second write
  // deciding its parent. Rejecting duplicate ids is what keeps the stored
  // tree acyclic; there is no re-parent endpoint that could produce one
  // another way.
  const ids = flat.map(({ input: c }) => c.id).filter((id): id is string => id != null);
  if (new Set(ids).size !== ids.length) {
    throw new CategoriesValidationError("a category may only appear once");
  }

  // Sibling names must differ; the same name under two different parents is
  // legitimate and the schema allows it.
  const siblingNames = new Map<number | null, Set<string>>();
  for (const { input: c, parentIndex } of flat) {
    const set = siblingNames.get(parentIndex) ?? new Set<string>();
    if (set.has(c.name.trim())) throw new CategoriesValidationError("duplicate category name");
    set.add(c.name.trim());
    siblingNames.set(parentIndex, set);
  }

  const allSymbols = [
    ...flat.flatMap(({ input: c }) => c.holdings.map((h) => h.symbol)),
    ...input.rootHoldings.map((t) => t.symbol),
  ];
  if (new Set(allSymbols).size !== allSymbols.length) {
    throw new CategoriesValidationError("a symbol may only appear once");
  }
  for (const t of input.rootHoldings) {
    if (!validTarget(t.targetPct)) throw new CategoriesValidationError("targetPct must be 0-100");
  }

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: category.id })
      .from(category)
      .where(eq(category.portfolioId, portfolioId));
    const existingIds = new Set(existing.map((e) => e.id));

    for (const id of ids) {
      if (!existingIds.has(id)) throw new CategoryNotFoundError(id);
    }

    const keptIds = new Set(ids);

    // Park every kept category on a collision-proof temp name and detach it
    // from its parent, so name swaps (A<->B), moves between levels, and
    // rename-vs-new-insert overlaps can't trip the sibling-name uniqueness
    // mid-transaction.
    //
    // Detaching must happen BEFORE the delete below: `parent_id` cascades, so
    // a kept child still pointing at a category the payload dropped would be
    // deleted along with it — silently losing a subtree the user only moved.
    for (const id of keptIds) {
      await tx
        .update(category)
        .set({ name: ` tmp-${id}`, parentId: null })
        .where(eq(category.id, id));
    }

    for (const id of existingIds) {
      if (!keptIds.has(id)) await tx.delete(category).where(eq(category.id, id));
    }
    await tx.delete(categoryAssignment).where(eq(categoryAssignment.portfolioId, portfolioId));

    const idByIndex: string[] = [];
    for (const [index, { input: c, parentIndex, position }] of flat.entries()) {
      const parentId = parentIndex == null ? null : (idByIndex[parentIndex] ?? null);
      const values = {
        name: c.name.trim(),
        parentId,
        targetPct: c.targetPct != null ? String(c.targetPct) : null,
        position,
      };
      if (c.id) {
        await tx.update(category).set(values).where(eq(category.id, c.id));
        idByIndex[index] = c.id;
      } else {
        const [row] = await tx
          .insert(category)
          .values({ portfolioId, ...values })
          .returning({ id: category.id });
        idByIndex[index] = row!.id;
      }
    }

    const assignmentValues = [
      ...flat.flatMap(({ input: c }, index) =>
        c.holdings
          .filter((h) => heldSymbols.has(h.symbol))
          .map((h) => ({
            portfolioId,
            symbol: h.symbol,
            categoryId: idByIndex[index]!,
            targetPct: h.targetPct != null ? String(h.targetPct) : null,
          })),
      ),
      ...input.rootHoldings
        .filter((t) => heldSymbols.has(t.symbol))
        .map((t) => ({
          portfolioId,
          symbol: t.symbol,
          categoryId: null as string | null,
          targetPct: String(t.targetPct),
        })),
    ];
    if (assignmentValues.length > 0) {
      await tx.insert(categoryAssignment).values(assignmentValues);
    }
  });
}
