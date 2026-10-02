import { cn, toneForValue } from "@sage/ui";
import { signedPct } from "../../../../lib/asset-page/labels";

/** A percent change inside a sentence: signed, with a true minus, toned at the
 *  precision it is shown (a +0.04% that displays as +0.0% is neutral). */
export function SignedPct({ pct }: { pct: number }) {
  const tone = toneForValue(Number(pct.toFixed(1)));
  return (
    <span
      data-tone={tone}
      className={cn(
        "tabular-nums",
        tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-neutral",
      )}
    >
      {signedPct(pct)}
    </span>
  );
}
