import * as React from "react";
import { cn } from "../../lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // rounded-control, not an arbitrary radius: DESIGN.md allows exactly
        // four radii, and inputs sit in the control tier with buttons and nav
        // items. The old rounded-[13px] was a fifth value nothing else used.
        //
        // Filled, not outlined, and no shadow. `--surface-active` is defined as
        // the input fill ("inputs, active chips") and always was — but the
        // control rendered `bg-background` inside `border-input`, so the field
        // was a hole with a line round it while the token describing it went
        // unused. Same inversion `Card` had. Fey's inputs are a flat ~7% wash
        // with no edge; this is that.
        // 16px and a 44px box on a phone, the desktop sizes from `md` up:
        // Safari zooms the page in on a focused field whose text is under
        // 16px, which happened on every field in the app, and 36px is under
        // the 44px touch target DESIGN.md sets for a row.
        "flex h-11 w-full rounded-control bg-surface-active px-3 py-1 text-base transition-colors",
        "md:h-9 md:text-sm",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
