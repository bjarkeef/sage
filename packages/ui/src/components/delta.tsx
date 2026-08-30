import * as React from "react";
import { cn } from "../lib/utils";

export type DeltaTone = "gain" | "loss" | "neutral";

/** Classify a numeric change into a finance tone. */
export function toneForValue(value: number): DeltaTone {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "neutral";
}

const toneClass: Record<DeltaTone, string> = {
  gain: "text-gain",
  loss: "text-loss",
  neutral: "text-neutral",
};

const chipToneClass: Record<DeltaTone, string> = {
  gain: "bg-gain/12",
  loss: "bg-loss/12",
  neutral: "bg-neutral/12",
};

const toneLabel: Record<DeltaTone, string> = {
  gain: "gain",
  loss: "loss",
  neutral: "flat",
};

export interface DeltaProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Signed change. Sign drives the tone and is rendered (+/−). */
  value: number;
  /** Optional signed percentage, rendered signed in parens. */
  percent?: number;
  /** ISO currency code. When set, the magnitude is formatted as currency. */
  currency?: string;
  /** BCP-47 locale for number formatting. */
  locale?: string;
  /** "chip" wraps the delta in a tone-tinted pill (hero usage). */
  variant?: "text" | "chip";
}

export function Delta({
  value,
  percent,
  currency,
  locale = "en-US",
  variant = "text",
  className,
  ...props
}: DeltaProps) {
  const tone = toneForValue(value);
  const formatter = new Intl.NumberFormat(locale, {
    style: currency ? "currency" : "decimal",
    currency,
    signDisplay: "exceptZero",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        toneClass[tone],
        variant === "chip" && cn("rounded-full px-2 py-0.5 font-mono text-xs", chipToneClass[tone]),
        className,
      )}
      data-tone={tone}
      {...props}
    >
      <span className="sr-only">{toneLabel[tone]}</span>
      <span>{formatter.format(value)}</span>
      {percent !== undefined && (
        <span>{`(${new Intl.NumberFormat(locale, {
          style: "percent",
          signDisplay: "exceptZero",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(percent / 100)})`}</span>
      )}
    </span>
  );
}
