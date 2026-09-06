import {
  LayoutGrid,
  Layers,
  Coins,
  PieChart,
  TrendingUp,
  Target,
  Shapes,
  Newspaper,
  ChartColumn,
  Upload,
  Split,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

/** Single source of truth for app navigation — consumed by the sidebar and the command palette. */
export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Overview", href: "/", icon: LayoutGrid },
      { label: "Holdings", href: "/holdings", icon: Layers },
      { label: "Goal", href: "/goal", icon: Target },
      { label: "Diversification", href: "/diversification", icon: PieChart },
      { label: "Categories", href: "/categories", icon: Shapes },
      { label: "Performance", href: "/performance", icon: TrendingUp },
      // Sits next to Performance rather than in its own group: it is read
      // from the same ledger and stored-price data, and the basis-mismatch
      // banner on /performance is the other entry point into this page.
      { label: "Corporate actions", href: "/corporate-actions", icon: Split },
      { label: "News", href: "/news", icon: Newspaper },
      // Not filed under "System" with Settings, where it sat until a first-run
      // walkthrough: import is how a book gets into Sage at all, and the
      // overview's own empty state tells people to import while the only place
      // it appeared was next to a settings page.
      { label: "Import", href: "/import", icon: Upload },
    ],
  },
  {
    // A group, not two loose items: the analytics page had no address at all,
    // and a second top-level "Dividend analytics" beside "Dividends" reads as
    // two topics. The group label renders as a header rather than a link, so
    // Calendar is the entry point that "Dividends" used to be.
    label: "Dividends",
    items: [
      { label: "Calendar", href: "/dividends", icon: Coins },
      { label: "Analytics", href: "/dividends/analytics", icon: ChartColumn },
    ],
  },
  {
    label: "System",
    items: [{ label: "Settings", href: "/settings", icon: SettingsIcon }],
  },
];

export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

/** The one nav entry that owns a path, as its href — or null when none does.
 *
 *  The LONGEST match wins, not any prefix. `/dividends/analytics` sits under
 *  `/dividends`, so a plain `startsWith` lights both entries at once: two
 *  highlighted sidebar rows, two in the More sheet, and `aria-current="page"`
 *  on the bottom bar's Calendar tab while the user is on Analytics. Every
 *  surface resolves the active entry through here so the next nested route
 *  does not have to rediscover that.
 *
 *  Matching is on segment boundaries: `/news` owns `/news/abc` but not a
 *  future `/newsletter`. "/" is a prefix of everything, so it matches only
 *  itself. */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of navItems) {
    const matches =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/** The routes the bottom bar surfaces on a phone — the ones checked daily.
 *  Everything else stays one tap away behind More, so this is a shortcut into
 *  `navItems` rather than a second navigation with routes of its own. Four is
 *  the ceiling: a fifth cell alongside More leaves targets too narrow to hit
 *  with a thumb at 375px.
 *
 *  A tab may override its label. The sidebar can call `/dividends` "Calendar"
 *  because the "Dividends" group header sits directly above it; the bottom bar
 *  has no group headers, so inheriting that label would leave the word
 *  "Dividends" nowhere in phone navigation and a coin icon labelled
 *  "Calendar". The href, icon and ordering still come from `navItems`. */
const MOBILE_TABS: { href: string; label?: string }[] = [
  { href: "/" },
  { href: "/holdings" },
  { href: "/dividends", label: "Dividends" },
  { href: "/performance" },
];

export const mobileTabs: NavItem[] = MOBILE_TABS.map(({ href, label }) => {
  const item = navItems.find((i) => i.href === href);
  if (!item) throw new Error(`mobileTabs: no nav item for ${href}`);
  return label ? { ...item, label } : item;
});
