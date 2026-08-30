import * as React from "react";
import { cn } from "../../lib/utils";

export interface FieldProps {
  /** Visible label. Sans, not `label-caps` — see DESIGN.md. */
  label: string;
  /** Id of the control this labels — the normal case, and what makes the
   *  label a real `<label for>` binding instead of the placeholder-as-label
   *  problem this primitive exists to fix. Omit only when there is nothing
   *  labelable to bind to (e.g. a locked identity row, or a group control
   *  that can't be named by `<label for>` at all) — the label then degrades
   *  to a plain caption instead of a binding that points at nothing. */
  htmlFor?: string;
  /** Id to mint on the caption when there's no `htmlFor` to bind to — lets a
   *  composite control that isn't itself labelable (e.g. a `role="radiogroup"`
   *  div) still adopt this caption via `aria-labelledby="${id}-label"`,
   *  without a decoy `htmlFor` pointing at an element that doesn't exist.
   *  Ignored when `htmlFor` is set (that already mints `${htmlFor}-label`). */
  id?: string;
  /** Muted line under the control. Suppressed while `error` is set. */
  hint?: React.ReactNode;
  /** Validation message; replaces the hint and colours in `--loss`. */
  error?: string;
  /** Right-aligned content in the label row (a secondary link, a unit toggle). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

/** One labelled form control. The label is sans `text-xs font-medium`, never
 *  `label-caps`: that token is a caps eyebrow over a figure, and a stack of
 *  them in one dialog both shouts and breaks the one-caps-per-region rule. */
export function Field({ label, htmlFor, id, hint, error, action, children }: FieldProps) {
  const labelClassName = "text-xs font-medium text-foreground";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        {htmlFor ? (
          // The id lets a control that can't itself be `<label for>`'d (e.g. a
          // `role="radiogroup"` div) still adopt this label via aria-labelledby.
          <label htmlFor={htmlFor} id={`${htmlFor}-label`} className={labelClassName}>
            {label}
          </label>
        ) : (
          <span id={id ? `${id}-label` : undefined} className={labelClassName}>
            {label}
          </span>
        )}
        {action}
      </div>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-loss">{error}</p>
      ) : hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/** Two fields side by side, stacking on narrow viewports. Replaces the
 *  `flex flex-wrap` that let controls reflow into ragged rows. */
export function FieldRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>{children}</div>;
}
