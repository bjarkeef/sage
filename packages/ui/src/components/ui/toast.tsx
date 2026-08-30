"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

/** Deliberately no "success" tone. Green is this app's *gain* colour, reserved
 *  for `Delta` figures and real money going up; spending it on "the write
 *  worked" both dilutes that signal and, on a deletion, actively misreads. A
 *  confirmation is neutral and says what changed — the words carry it. */
export type ToastTone = "info" | "error";

export interface ToastOptions {
  title: string;
  /** Optional second line — the specifics ("10 AAPL at $150.00"). */
  description?: string;
  tone?: ToastTone;
}

interface ToastRecord extends ToastOptions {
  id: number;
  /** Playing its exit animation — still mounted, no longer interactive. */
  leaving?: boolean;
}

/** Must stay in step with the `fade-out-down` utility in globals.css: the row
 *  unmounts when this elapses, so a shorter value clips the animation and a
 *  longer one leaves an invisible toast holding its slot in the stack. */
const EXIT_MS = 200;

/** A confirmation can slide past unread without costing anything. A failure is
 *  something the user has to act on, so it stays up more than twice as long. */
const DISMISS_MS: Record<ToastTone, number> = {
  info: 5000,
  error: 12000,
};

/** Older messages drop off the top rather than growing a wall the user has to
 *  read backwards. */
const MAX_VISIBLE = 3;

const ToastContext = React.createContext<{ toast: (opts: ToastOptions) => void } | null>(null);

/** Raise transient confirmations from anywhere under the provider.
 *
 *  ```tsx
 *  const { toast } = useToast();
 *  toast({ title: "Transaction added", description: "10 AAPL" });
 *  ``` */
export function useToast(): { toast: (opts: ToastOptions) => void } {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside a <ToastProvider>");
  return ctx;
}

const toneClass: Record<ToastTone, string> = {
  info: "border-hairline bg-surface-card",
  error: "border-destructive/30 bg-destructive/10",
};

const toneTitleClass: Record<ToastTone, string> = {
  info: "text-foreground",
  error: "text-destructive",
};

/** App-level provider. Mounts one live region for the whole app and hands out
 *  `toast()` through context. Put it inside the client provider tree, once. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const leaving = React.useRef(new Set<number>());

  const dismiss = React.useCallback((id: number) => {
    // A ref, not the rendered `leaving` flag: a state updater runs during
    // render, so reading the flag back here would still see the old value and
    // every repeat dismiss would restart the exit timer.
    if (leaving.current.has(id)) return;
    leaving.current.add(id);

    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));

    // Unmount after the exit animation rather than on the spot, so the toast
    // fades instead of blinking out.
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        leaving.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, EXIT_MS),
    );
  }, []);

  const toast = React.useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { ...opts, id }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS[opts.tone ?? "info"]),
      );
    },
    [dismiss],
  );

  // Timers outlive the component otherwise, and fire setState on an unmounted
  // tree during navigation.
  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always mounted, even when empty: assistive tech announces content
       *  inserted into a live region already in the tree, not a region that
       *  appears alongside its content. */}
      <div
        data-testid="toast-viewport"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const tone = toast.tone ?? "info";
  return (
    <div
      // An error interrupts; a confirmation waits its turn.
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "flex w-full max-w-sm items-start gap-3 rounded-card border px-4 py-3",
        toast.leaving ? "fade-out-down pointer-events-none" : "fade-up pointer-events-auto",
        toneClass[tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", toneTitleClass[tone])}>{toast.title}</div>
        {toast.description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{toast.description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 rounded-control p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
