"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, PageHeader, PageShell, SectionHeader, Switch } from "@sage/ui";
import {
  deleteAllHoldings,
  getUserSettings,
  patchOverviewPrefs,
  updateAutoAddDividends,
  updateDividendTaxRate,
  updateAllowNegativeDividendGrowth,
  updateDisplayName,
  updateMediaPrefs,
} from "@/lib/api";
import { parseDecimalInput } from "@/lib/decimal-input";
import { invalidateFor } from "@/lib/query/invalidation";
import { qk } from "@/lib/query/keys";
import type { OverviewPrefs } from "@/lib/types";
import { authClient } from "@/lib/auth-client";
import { ExportSection } from "@/components/export-section";
import { SystemSection } from "./system-section";

const OVERVIEW_ROWS: { key: keyof OverviewPrefs; label: string; description: string }[] = [
  {
    key: "brief",
    label: "Morning brief",
    description: "A short written summary of your day above the page.",
  },
  {
    key: "paydayGreeting",
    label: "Payday greetings",
    description: "Mention dividends that landed since your last visit.",
  },
  {
    key: "marketState",
    label: "Market status",
    description: "Show whether markets are open, closed, or asleep.",
  },
  {
    key: "statStrip",
    label: "Stat strip",
    description: "A compact top row: YTD return, income, and return vs cost.",
  },
  {
    key: "goalBand",
    label: "Goal progress",
    description: "How close the income is to the goal, and the year you set for it.",
  },
  {
    key: "performanceCard",
    label: "Performance card",
    description: "Year-to-date and total return.",
  },
  {
    key: "incomeCard",
    label: "Income card",
    description: "Dividend income this month and the year ahead.",
  },
  {
    key: "portfolioCard",
    label: "Portfolio card",
    description: "Your largest holdings at a glance.",
  },
  {
    key: "upcomingCard",
    label: "Upcoming card",
    description: "The next dividends heading your way.",
  },
  {
    key: "tapeMotion",
    label: "Motion",
    description:
      "Glide, count and animate the income tape. Always off when your system asks for reduced motion.",
  },
];

/** logo.dev publishable keys — the same shape the API accepts. */
const LOGO_KEY_PATTERN = /^pk_[A-Za-z0-9_-]+$/;
const LOGO_KEY_MAX = 200;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [prefs, setPrefs] = useState<OverviewPrefs | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Committed dividend tax rate (last value confirmed by the server) and the
  // raw text of the controlled input — kept separate so an in-flight edit
  // doesn't get clobbered, and so a failed save can revert the input to the
  // last-known-good committed value.
  const [taxRate, setTaxRate] = useState<number | null>(null);
  const [taxRateInput, setTaxRateInput] = useState<string>("");

  const [autoAdd, setAutoAdd] = useState<boolean | null>(null);
  const [allowNegativeGrowth, setAllowNegativeGrowth] = useState<boolean | null>(null);
  const [showLogos, setShowLogos] = useState<boolean | null>(null);
  const [showThumbnails, setShowThumbnails] = useState<boolean | null>(null);
  // Committed logo.dev key and the input's raw text, kept apart for the same
  // reason as the tax rate: an invalid or failed save reverts to the last
  // value the server confirmed.
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [logoKeyInput, setLogoKeyInput] = useState("");
  const [logoKeyError, setLogoKeyError] = useState<string | undefined>(undefined);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const { data: settings } = useQuery({
    queryKey: qk.userSettings(),
    queryFn: getUserSettings,
    staleTime: 300_000,
  });

  // Hydrate local state from the first available settings snapshot only.
  // Later refetches (e.g. the invalidation that follows handleToggle) must
  // not re-sync, or an in-flight (un-blurred) edit would be silently reset
  // to the server value.
  const hydrated = useRef(false);
  useEffect(() => {
    if (settings && !hydrated.current) {
      hydrated.current = true;
      setPrefs(settings.overviewPrefs);
      setTaxRate(settings.dividendTaxRate);
      setTaxRateInput(settings.dividendTaxRate != null ? String(settings.dividendTaxRate) : "");
      setAutoAdd(settings.autoAddDividends);
      setAllowNegativeGrowth(settings.allowNegativeDividendGrowth);
      setShowLogos(settings.showCompanyLogos);
      setShowThumbnails(settings.showNewsThumbnails);
      setLogoKey(settings.logoDevToken);
      setLogoKeyInput(settings.logoDevToken ?? "");
      setNameDraft(settings.name);
    }
  }, [settings]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  async function handleToggle(key: keyof OverviewPrefs, value: boolean) {
    if (!prefs) return;
    // Snapshot only this key so concurrent toggles of other keys are not clobbered on revert.
    const previousValue = prefs[key];
    // Functional update so overlapping in-flight flips compose instead of racing on stale state.
    setPrefs((cur) => (cur ? { ...cur, [key]: value } : cur));
    setSaved(false);
    try {
      await patchOverviewPrefs({ [key]: value });
      await invalidateFor(queryClient, "overview-prefs");
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch {
      // Revert only this key; leave any other keys the user changed meanwhile intact.
      setPrefs((cur) => (cur ? { ...cur, [key]: previousValue } : cur));
    }
  }

  /** Commits a validated tax-rate value: no-op if unchanged, optimistic-free
   *  (only flips `taxRate` on confirmed success) so a failed PATCH just
   *  reverts the input text rather than lying about the committed state. */
  async function commitTaxRate(value: number | null) {
    if (value === taxRate) return;
    try {
      await updateDividendTaxRate(value);
      setTaxRate(value);
      await invalidateFor(queryClient, "dividend-tax-rate");
    } catch {
      setTaxRateInput(taxRate != null ? String(taxRate) : "");
    }
  }

  function handleTaxRateBlur() {
    const trimmed = taxRateInput.trim();
    if (trimmed === "") {
      void commitTaxRate(null);
      return;
    }
    const parsed = parseDecimalInput(trimmed);
    if (parsed === null || parsed < 0 || parsed > 100) {
      // Invalid — revert the input without saving.
      setTaxRateInput(taxRate != null ? String(taxRate) : "");
      return;
    }
    void commitTaxRate(parsed);
  }

  async function handleAutoAddToggle(value: boolean) {
    const previous = autoAdd;
    setAutoAdd(value);
    try {
      await updateAutoAddDividends(value);
      await invalidateFor(queryClient, "transaction");
    } catch {
      setAutoAdd(previous);
    }
  }

  async function handleAllowNegativeGrowthToggle(value: boolean) {
    const previous = allowNegativeGrowth;
    setAllowNegativeGrowth(value);
    try {
      await updateAllowNegativeDividendGrowth(value);
      await invalidateFor(queryClient, "allow-negative-dividend-growth");
    } catch {
      setAllowNegativeGrowth(previous);
    }
  }

  // The app-wide MediaPrefsProvider follows this query, so invalidating it is
  // what makes logos and thumbnails appear or vanish without a reload.
  async function handleShowLogosToggle(value: boolean) {
    const previous = showLogos;
    setShowLogos(value);
    try {
      await updateMediaPrefs({ showCompanyLogos: value });
      await queryClient.invalidateQueries({ queryKey: qk.userSettings() });
    } catch {
      setShowLogos(previous);
    }
  }

  async function handleShowThumbnailsToggle(value: boolean) {
    const previous = showThumbnails;
    setShowThumbnails(value);
    try {
      await updateMediaPrefs({ showNewsThumbnails: value });
      await queryClient.invalidateQueries({ queryKey: qk.userSettings() });
    } catch {
      setShowThumbnails(previous);
    }
  }

  async function handleLogoKeyBlur() {
    const trimmed = logoKeyInput.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== null && (next.length > LOGO_KEY_MAX || !LOGO_KEY_PATTERN.test(next))) {
      // Invalid — revert the input without saving, and say why.
      setLogoKeyInput(logoKey ?? "");
      setLogoKeyError("That is not a publishable key. It starts with pk_.");
      return;
    }
    setLogoKeyInput(next ?? "");
    if (next === logoKey) return;
    try {
      await updateMediaPrefs({ logoDevToken: next });
      setLogoKey(next);
      await queryClient.invalidateQueries({ queryKey: qk.userSettings() });
    } catch {
      setLogoKeyInput(logoKey ?? "");
    }
  }

  const defaultLogoKey = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN || null;
  const nameDirty = nameDraft.trim().length > 0 && nameDraft.trim() !== (settings?.name ?? "");

  async function handleSaveName() {
    const next = nameDraft.trim();
    if (!next || next === settings?.name) return;
    setNameSaving(true);
    try {
      await updateDisplayName(next);
      // The greeting reads the SESSION, not this query, so invalidating
      // user-settings alone would leave the overview greeting the old name
      // until the next full load.
      await queryClient.invalidateQueries({ queryKey: qk.userSettings() });
      await authClient.getSession({ query: { disableCookieCache: true } });
      setNameSaved(true);
    } catch {
      alert("Could not save your name.");
    } finally {
      setNameSaving(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await deleteAllHoldings();
      await invalidateFor(queryClient, "holdings");
      setDone(true);
      setConfirming(false);
    } catch {
      alert("Failed to delete holdings.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell width="narrow" className="py-10">
      <PageHeader title="Settings" />

      <div id="you" className="mt-8 scroll-mt-8">
        <SectionHeader title="You" className="mb-0" />
        <p className="mt-1 text-xs text-muted-foreground">
          What the overview greets you by. A first name is enough.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveName();
          }}
        >
          {/* Field, not a bare Input with an aria-label: this is the only form
              in the app where the control had no visible name of its own, and
              the sentence above it belongs to the section rather than to the
              box. */}
          <Field label="Your name" htmlFor="display-name">
            <Input
              id="display-name"
              value={nameDraft}
              disabled={settings === undefined}
              maxLength={80}
              onChange={(e) => {
                setNameDraft(e.target.value);
                setNameSaved(false);
              }}
              className="w-56"
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={!nameDirty || nameSaving}>
            {nameSaving ? "Saving…" : "Save"}
          </Button>
          {nameSaved && <span className="text-xs text-muted-foreground">Saved</span>}
        </form>
      </div>

      <div id="overview" className="mt-8 scroll-mt-8">
        <SectionHeader title="Overview" meta={saved ? "Saved" : undefined} className="mb-0" />
        <p className="mt-1 text-xs text-muted-foreground">Choose what your frontpage shows.</p>
        <div className="mt-3 divide-y divide-hairline">
          {OVERVIEW_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.description}</p>
              </div>
              <Switch
                aria-label={row.label}
                checked={prefs?.[row.key] ?? true}
                disabled={!prefs}
                onCheckedChange={(value) => void handleToggle(row.key, value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader title="Dividends" className="mb-0" />
        <p className="mt-1 text-xs text-muted-foreground">
          Sage has no tax-residency model — set one rate to see a net, after-tax yield on the
          Analytics page.
        </p>
        <div className="mt-3 divide-y divide-hairline">
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">Add dividends automatically</p>
              <p className="text-xs text-muted-foreground">
                Sage records dividends you were owed based on payment history and your holdings.
                Recommended unless your broker export already includes dividends.
              </p>
            </div>
            <Switch
              aria-label="Add dividends automatically"
              checked={autoAdd ?? true}
              disabled={autoAdd === null}
              onCheckedChange={(v) => void handleAutoAddToggle(v)}
            />
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <label htmlFor="dividend-tax-rate" className="text-sm font-medium">
                Dividend tax rate (%)
              </label>
              <p className="text-xs text-muted-foreground">Leave blank to show gross yield only.</p>
            </div>
            <Input
              id="dividend-tax-rate"
              inputMode="decimal"
              placeholder="—"
              value={taxRateInput}
              onChange={(e) => setTaxRateInput(e.target.value)}
              onBlur={handleTaxRateBlur}
              className="w-20 text-right font-mono text-sm tabular-nums"
            />
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">Allow negative dividend growth</p>
              <p className="text-xs text-muted-foreground">
                When on (default), a holding that&apos;s cutting its dividend pulls the portfolio
                growth figure down — an honest but less flattering number. Turn off to floor each
                holding at 0% before averaging, closer to how some other trackers report it.
              </p>
            </div>
            <Switch
              aria-label="Allow negative dividend growth"
              checked={allowNegativeGrowth ?? true}
              disabled={allowNegativeGrowth === null}
              onCheckedChange={(v) => void handleAllowNegativeGrowthToggle(v)}
            />
          </div>
        </div>
      </div>

      <div id="privacy" className="mt-8 scroll-mt-8">
        <SectionHeader title="Privacy" className="mb-0" />
        <p className="mt-1 text-xs text-muted-foreground">
          Both are off by default. Turning one on means your browser asks a third party about each
          holding it shows.
        </p>
        <div className="mt-3 divide-y divide-hairline">
          <div className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Company logos</p>
                <p className="text-xs text-muted-foreground">
                  Real logos from logo.dev instead of initials. logo.dev sees which companies you
                  look at.
                </p>
              </div>
              <Switch
                aria-label="Company logos"
                checked={showLogos ?? false}
                disabled={showLogos === null}
                onCheckedChange={(v) => void handleShowLogosToggle(v)}
              />
            </div>
            {(showLogos || logoKey !== null) && (
              <div className="mt-3">
                <Field
                  label="logo.dev publishable key"
                  htmlFor="logo-dev-key"
                  error={logoKeyError}
                  hint="Free at logo.dev. Starts with pk_. Leave empty to use this instance's default key, if one was built in."
                >
                  <Input
                    id="logo-dev-key"
                    placeholder="pk_…"
                    autoComplete="off"
                    spellCheck={false}
                    value={logoKeyInput}
                    onChange={(e) => {
                      setLogoKeyInput(e.target.value);
                      setLogoKeyError(undefined);
                    }}
                    onBlur={() => void handleLogoKeyBlur()}
                    className="w-full max-w-sm font-mono text-sm"
                  />
                </Field>
              </div>
            )}
            {showLogos && logoKey === null && defaultLogoKey === null && (
              <p className="mt-2 text-xs text-muted-foreground">
                Logos stay as initials until a key is set.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">News thumbnails</p>
              <p className="text-xs text-muted-foreground">
                Article images, loaded from each news source&apos;s servers.
              </p>
            </div>
            <Switch
              aria-label="News thumbnails"
              checked={showThumbnails ?? false}
              disabled={showThumbnails === null}
              onCheckedChange={(v) => void handleShowThumbnailsToggle(v)}
            />
          </div>
        </div>
      </div>

      <ExportSection />

      <SystemSection />

      <div className="mt-8">
        <SectionHeader title="Danger zone" className="mb-0" />
        <div className="mt-3 rounded-card border border-destructive/40 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete all holdings</p>
              <p className="text-xs text-muted-foreground">
                Permanently remove all transactions from your portfolio. This cannot be undone.
              </p>
            </div>
            {!confirming ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(true)}
                disabled={done}
                className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {done ? "Deleted" : "Delete all"}
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleDelete()}
                  disabled={loading}
                >
                  {loading ? "Deleting..." : "Confirm delete"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* One line, not the full statement — that lives in the README. An app
          this calm should not carry three paragraphs of compliance text in a
          page nobody opens. What has to be in the app is the caveat attached to
          a figure while you are reading it, which is why the goal page carries
          its own line and this one only points at the rest. */}
      <p className="mt-8 border-t border-hairline pt-4 text-xs text-muted-foreground">
        Sage records and measures; it does not advise. Not financial, investment, tax, or legal
        advice, and figures may be stale or incomplete — see the README for the full statement.
      </p>
    </PageShell>
  );
}
