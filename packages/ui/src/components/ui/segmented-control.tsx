import { cn } from "../../lib/utils";

export interface SegmentedControlOption {
  label: string;
  value: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "default";
  className?: string;
  /** Lock the control on its current value — a choice something else on the
   *  page has made for it. Options stay visible and announce as disabled. */
  disabled?: boolean;
  /** Names the radiogroup for assistive tech. `<label for>` can't target a
   *  `role="radiogroup"` div — it only binds to labelable elements — so a
   *  caller with a visible label must point this at that label's id instead. */
  "aria-labelledby"?: string;
  /** Points at visible text that explains the control's state, e.g. why it is
   *  locked. */
  "aria-describedby"?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  size = "default",
  className,
  disabled = false,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5",
        className,
      )}
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              // Every other interactive primitive in this package draws its own
              // focus ring; this one leaned on the UA outline. Same treatment
              // as Button, so the two agree wherever they sit in a row.
              // nowrap: a multi-word label ("Year to date") never breaks in two;
              // a caller short of room scrolls the control instead.
              "whitespace-nowrap rounded-full font-mono font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-[13px]",
              "disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground enabled:hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
