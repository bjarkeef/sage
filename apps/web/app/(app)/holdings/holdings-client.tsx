"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageShell, SectionHeader, buttonVariants } from "@sage/ui";
import { getPortfolio } from "../../../lib/api";
import { qk } from "../../../lib/query/keys";
import { HoldingsList } from "../../../components/holdings-list";
import { TransactionDialog } from "../../../components/transaction-dialog";
import { TransactionsList } from "../../../components/transactions-list";
import { AppPageHeader } from "../../../components/app-page-header";

export function HoldingsClient() {
  const { data: portfolio } = useQuery({
    queryKey: qk.portfolio(),
    queryFn: () => getPortfolio(),
  });

  if (!portfolio) return null; // hydrated on first paint; guards SSR fallback

  return (
    <PageShell>
      <AppPageHeader
        title="Holdings"
        description="All positions across your portfolio."
        actions={
          <>
            <Link href="/custom-holding/new" className={buttonVariants({ variant: "secondary" })}>
              Add custom holding
            </Link>
            <TransactionDialog mode="add" />
          </>
        }
      />
      <HoldingsList positions={portfolio.positions} subtotals={portfolio.subtotalsByCurrency} />

      <section className="mt-12">
        <SectionHeader title="Activity" />
        <TransactionsList />
      </section>
    </PageShell>
  );
}
