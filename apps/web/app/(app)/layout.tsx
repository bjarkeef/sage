import type { ReactNode } from "react";
import { PageShell } from "@sage/ui";
import { Sidebar } from "../../components/sidebar";
import { MobileNav } from "../../components/mobile-nav";
import { DisplayCurrencyProvider } from "../../components/display-currency-context";
import { ProvidersDegradedCallout } from "../../components/providers-degraded-callout";
import { getUserSettings } from "../../lib/api";
import type { UserSettingsDTO } from "../../lib/types";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let settings: UserSettingsDTO;
  try {
    settings = await getUserSettings();
  } catch {
    settings = {
      displayCurrency: null,
      overviewPrefs: {
        brief: true,
        paydayGreeting: true,
        marketState: true,
        incomeRoom: true,
        portfolioRoom: true,
        statStrip: false,
        goalBand: true,
        performanceCard: true,
        incomeCard: true,
        portfolioCard: true,
        upcomingCard: true,
      },
      dividendTaxRate: null,
      autoAddDividends: true,
      allowNegativeDividendGrowth: true,
    };
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      {/* Bottom padding below md clears the fixed tab bar plus the iPhone home
          indicator, so the last row of a page is never trapped underneath it. */}
      <main className="relative flex-1 overflow-y-auto py-7 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-7">
        <DisplayCurrencyProvider value={settings.displayCurrency}>
          <PageShell>
            <ProvidersDegradedCallout />
          </PageShell>
          {children}
        </DisplayCurrencyProvider>
      </main>
      <MobileNav />
    </div>
  );
}
