"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, ChevronsUpDown } from "lucide-react";
import { SageMark, ThemeToggle, Popover, PopoverTrigger, PopoverContent } from "@sage/ui";
import { authClient } from "../lib/auth-client";
import { activeNavHref, navGroups } from "../lib/nav";
import { SignOutButton } from "./sign-out-button";

const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), {
  ssr: false,
});

export function Sidebar() {
  const pathname = usePathname();
  // Longest match, resolved once for the whole nav — see `activeNavHref`.
  const currentHref = activeNavHref(pathname);
  const { data: session } = authClient.useSession();
  const email = session?.user?.email ?? "";

  return (
    <>
      <CommandPalette />
      {/* 220px of a 375px phone leaves a 155px content column, so below md the
          sidebar leaves the flow entirely and MobileNav takes over. */}
      {/* `bg-sidebar`, not `bg-background`. Fey sits its sidebar on the same
          ground as the page and gets away with it because on near-black a
          1px hairline is a visible edge. In light the two were both near-white
          and the hairline was all that separated them, so the shell stopped
          reading as a shell. The token is the page ground in dark (Fey's
          behaviour, unchanged) and a half-step down from it in light. */}
      <aside className="hidden h-screen w-55 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex items-center gap-2 px-4 pb-5 pt-6">
          <SageMark size={19} color="var(--foreground)" accent="var(--primary)" />
          <span className="font-display text-sm font-medium tracking-tight">Sage</span>
        </div>

        <button
          type="button"
          onClick={() =>
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }
          className="mx-3 mb-5 flex items-center gap-2 rounded-control bg-muted/60 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="flex-1">Search...</span>
          <kbd className="rounded-badge border border-border bg-card px-1 py-0.5 font-mono text-xs">
            {"⌘"}K
          </kbd>
        </button>

        <nav className="flex flex-1 flex-col gap-4 px-3">
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
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-control px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-surface-active font-medium text-foreground"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-control px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-active font-mono text-xs font-medium text-foreground">
                  {email ? email[0]?.toUpperCase() : "?"}
                </span>
                <span className="flex-1 truncate text-xs text-foreground">{email}</span>
                <ChevronsUpDown
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" sideOffset={8} className="w-49 p-1.5">
              <div className="flex items-center justify-between px-1.5 py-1.5">
                <span className="label-caps text-muted-foreground">Appearance</span>
                <ThemeToggle />
              </div>
              <div className="my-1 border-t border-border" />
              <SignOutButton />
              <div className="mt-1 flex items-center gap-1.5 border-t border-border px-1.5 pt-2 font-mono text-xs text-muted-foreground/50">
                <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                v0.1
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </aside>
    </>
  );
}
