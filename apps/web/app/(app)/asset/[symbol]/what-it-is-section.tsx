"use client";

import * as React from "react";
import { Card, SectionHeader, cn } from "@sage/ui";
import { formatCompactMoney } from "../../../../lib/format";
import { isFilled, isPositiveFigure, prettySector } from "../../../../lib/asset-page/labels";
import type { AssetProfileDTO } from "../../../../lib/types";
import { FactRow, type Fact } from "./fact-row";
import { FundComposition } from "./fund-composition";

/** Above this length the description is clamped behind "more". */
const CLAMP_CHARS = 240;

function Description({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > CLAMP_CHARS;
  return (
    <div className="mb-4">
      <p
        className={cn(
          "text-sm leading-relaxed text-muted-foreground",
          long && !open && "line-clamp-3",
        )}
      >
        {text.trim()}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mt-1 rounded-control text-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

/**
 * § 7, "What it is". A stock: sector, industry, CEO, employees, website. A fund:
 * family, legal type, assets, category, then its composition. Rows the
 * provider left empty — or filled with a lone dash — are not drawn. The
 * old Fundamentals card is dissolved: its market figures live in Buy more?.
 */
export function WhatItIsSection({
  profile,
  profileAsOf,
  todayISO,
}: {
  profile: AssetProfileDTO;
  profileAsOf: string | null;
  todayISO: string;
}) {
  const fund = profile.fund;
  const rows: Fact[] = (
    fund
      ? [
          { label: "Fund family", value: isFilled(fund.family) ? fund.family : null },
          { label: "Legal type", value: isFilled(fund.legalType) ? fund.legalType : null },
          {
            label: "Assets under management",
            value: isPositiveFigure(fund.totalAssets)
              ? formatCompactMoney(fund.totalAssets, profile.currency)
              : null,
          },
          { label: "Category", value: isFilled(fund.category) ? fund.category : null },
        ]
      : [
          {
            label: "Sector",
            value: isFilled(profile.sector) ? prettySector(profile.sector) : null,
          },
          { label: "Industry", value: isFilled(profile.industry) ? profile.industry : null },
          { label: "CEO", value: isFilled(profile.ceo) ? profile.ceo : null },
          {
            label: "Employees",
            value: isPositiveFigure(profile.fullTimeEmployees)
              ? Number(profile.fullTimeEmployees).toLocaleString("en-US")
              : null,
          },
          {
            label: "Website",
            value: isFilled(profile.website) ? (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            ) : null,
          },
        ]
  )
    .filter((r) => r.value != null)
    .map((r) => ({ ...r, asOf: profileAsOf, text: true }));

  const description = isFilled(profile.description) ? profile.description : null;
  const hasComposition =
    fund != null && (fund.holdings.length > 0 || fund.sectorWeightings.length > 0);
  if (!description && rows.length === 0 && !hasComposition) return null;

  return (
    <section className="mb-10">
      <SectionHeader title="What it is" />
      {(description || rows.length > 0) && (
        <Card className="mb-4">
          {description && <Description text={description} />}
          {rows.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-12 sm:grid-cols-2">
              {rows.map((r) => (
                <FactRow key={r.label} fact={r} todayISO={todayISO} />
              ))}
            </dl>
          )}
        </Card>
      )}
      {fund && <FundComposition fund={fund} asOf={profileAsOf} todayISO={todayISO} />}
    </section>
  );
}
