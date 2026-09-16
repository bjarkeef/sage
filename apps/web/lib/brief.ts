export type BriefSegment =
  | { kind: "text"; text: string }
  | { kind: "value"; text: string; tone: "gain" | "loss" | "income" | "neutral" };

export interface BriefInput {
  totalValue: string | null;
  todayChange: { amount: string; percent: number } | null;
  mover: { symbol: string; percent: number } | null;
  paydays: { symbol: string; income: string }[];
  paydaysTotal: string | null; // formatted sum of paydays, same currency
  nextPayout: { symbol: string; income: string; when: "today" | "thisWeek" } | null;
  positionsCount: number;
}

const t = (text: string): BriefSegment => ({ kind: "text", text });
const v = (text: string, tone: "gain" | "loss" | "income" | "neutral"): BriefSegment => ({
  kind: "value",
  text,
  tone,
});

const MOVER_THRESHOLD = 0.5;

/** The clauses after the opening portfolio line: payday > mover > quiet,
 *  then an optional next-payout note. Shared by composeBrief and composeColorLine. */
function variantClauses(input: BriefInput): BriefSegment[] {
  const out: BriefSegment[] = [];
  if (input.paydays.length > 0) {
    const names = input.paydays.map((p) => p.symbol);
    const who =
      names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
    const amount = input.paydays.length === 1 ? input.paydays[0]!.income : input.paydaysTotal;
    out.push(t(`${who} paid you `), v(amount ?? "", "income"), t(" overnight."));
    return out; // payday suppresses the next-payout clause
  }
  if (input.mover && Math.abs(input.mover.percent) >= MOVER_THRESHOLD) {
    // Says what moved, in price, today. "Doing most of the lifting" sat under
    // the income figure and read as a claim about the income.
    out.push(
      t(
        input.mover.percent > 0
          ? `${input.mover.symbol} rose most today.`
          : `${input.mover.symbol} fell most today.`,
      ),
    );
  } else {
    // Not "nothing needs your attention": the app cannot know that, and a mood
    // is the one thing this slot must never carry. Rejected by the maintainer
    // 2026-09-13 in the front-page proposal, where the same phrasing had been
    // written into a mockup — and found already shipping here. The grammar is
    // what moved, then what is coming; when nothing moved, say only that.
    out.push(t("No holding moved much today."));
  }
  if (input.nextPayout) {
    const when = input.nextPayout.when === "today" ? "today" : "this week";
    out.push(
      t(` ${input.nextPayout.symbol} pays out ${when}, around `),
      v(input.nextPayout.income, "income"),
      t("."),
    );
  }
  return out;
}

export function composeBrief(input: BriefInput): BriefSegment[] {
  if (input.positionsCount === 0) {
    return [t("Welcome to Sage. Import your transactions to get started.")];
  }

  const out: BriefSegment[] = [];

  // Opening: level + today.
  if (input.totalValue) {
    out.push(t("Your portfolio stands at "), v(input.totalValue, "neutral"));
    if (input.todayChange) {
      const { amount, percent } = input.todayChange;
      const tone = percent >= 0 ? "gain" : "loss";
      // Match the app's en-US number convention (the money elsewhere is
      // formatMoney's "$1,234.56"): a true minus, a dot decimal, no space
      // before %. The amount carries its own sign, so normalize its leading
      // ASCII hyphen to a true minus too — otherwise "−0.12%" would sit beside
      // a hyphen-signed "-$8.48" in the same clause.
      const amountStr = amount.replace(/^-/, "−");
      const pct = `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(2)}%`;
      out.push(t(" — "), v(`${amountStr} (${pct})`, tone), t(" today."));
    } else {
      out.push(t("."));
    }
  }

  // Variant clause: payday > mover > quiet, then optional next-payout note.
  // variantClauses' segments start without a leading space; splice the
  // joining space onto the first segment so the composed sentence is
  // unchanged from the pre-refactor inline version.
  const [first, ...rest] = variantClauses(input);
  out.push(t(` ${first!.text}`), ...rest);

  return out;
}

/** Figure-free greeting sentence for the redesigned overview: the color clause
 *  only — no portfolio value, no total day-change (those live in the hero). */
export function composeColorLine(input: BriefInput): BriefSegment[] {
  if (input.positionsCount === 0) {
    return [t("Welcome to Sage. Import your transactions to get started.")];
  }
  return variantClauses(input);
}

export type MarketState = "open" | "preOpen" | "closed" | "weekend";

/** Local-time approximation: 09:00 (Copenhagen open) through 22:00 (NYSE close)
 *  counts as open for a CET user. No per-exchange calendars. */
export function marketState(now: Date): MarketState {
  const day = now.getDay();
  if (day === 0 || day === 6) return "weekend";
  const hour = now.getHours();
  if (hour < 9) return "preOpen";
  if (hour < 22) return "open";
  return "closed";
}

export function marketStateLine(
  state: MarketState,
  todayChange: { percent: number } | null,
): BriefSegment[] {
  switch (state) {
    case "open":
      return [t("Markets are open.")];
    case "preOpen":
      return [t("Markets open later today.")];
    case "weekend":
      return [t("Markets are asleep. See you Monday.")];
    case "closed":
      if (!todayChange) return [t("Markets are closed.")];
      return todayChange.percent >= 0
        ? [t("Markets closed "), v("green", "gain"), t(".")]
        : [t("Markets closed "), v("red", "loss"), t(".")];
  }
}
