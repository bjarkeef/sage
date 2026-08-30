"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogClose, ThemeToggle } from "@sage/ui";
import { activeNavHref, mobileTabs, navGroups } from "../lib/nav";
import { SignOutButton } from "./sign-out-button";

/**
 * Phone navigation: a bottom bar over the routes checked daily, with every
 * other route one tap away behind More.
 *
 * Bottom-anchored rather than a top hamburger because the phone case is
 * one-handed — the reachable third of the screen is the bottom, not the top.
 * The sidebar takes over from `md` up and this disappears entirely; the two
 * never render together.
 *
 * More opens the app's own DialogContent, which already anchors to the bottom
 * as a sheet below `sm` and scrolls its own overflow, so the drawer needs no
 * geometry of its own.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  // One entry is current, the longest href that owns this path — see
  // `activeNavHref`. On `/dividends/analytics` that is Analytics, so the bar's
  // Calendar tab correctly claims nothing.
  const currentHref = activeNavHref(pathname);

  // A tap that navigates has to close the sheet: Next routes client-side, so
  // without this the sheet stays open over the page it just moved to.
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {mobileTabs.map(({ label, href, icon: Icon }) => {
          const active = href === currentHref;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-1 py-2 text-xs text-muted-foreground transition-colors"
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
          More
        </button>
      </nav>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Menu</DialogTitle>
          <div className="mt-4 flex flex-col gap-4">
            {navGroups.map((group) => (
              <div key={group.label ?? "primary"} className="flex flex-col gap-0.5">
                {group.label && (
                  <div className="label-caps px-2.5 pb-1.5 text-muted-foreground/70">
                    {group.label}
                  </div>
                )}
                {group.items.map(({ label, href, icon: Icon }) => {
                  const active = href === currentHref;
                  return (
                    <DialogClose asChild key={href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-control px-2.5 py-2.5 text-sm transition-colors ${
                          active ? "bg-accent font-medium text-primary" : "text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                        {label}
                      </Link>
                    </DialogClose>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-border px-1.5 pt-4">
            <span className="label-caps text-muted-foreground">Appearance</span>
            <ThemeToggle />
          </div>
          <div className="mt-1">
            <SignOutButton />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
