"use client";

import { useState } from "react";
import { Button, SectionHeader } from "@sage/ui";
import { downloadExportJson, downloadTransactionsCsv } from "../lib/api";

/**
 * Data export. Two files with two different jobs: a CSV of the ledger for
 * taking elsewhere, and a JSON file of everything you have entered.
 *
 * Deliberately not one "export" button — the formats are not interchangeable,
 * and saying so up front is cheaper than explaining it afterwards.
 */
export function ExportSection() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);

  async function run(which: "csv" | "json") {
    setError(null);
    setBusy(which);
    try {
      await (which === "csv" ? downloadTransactionsCsv() : downloadExportJson());
    } catch {
      setError("Could not build the file. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8">
      <SectionHeader title="Your data" className="mb-0" />
      <p className="mt-1 text-xs text-muted-foreground">
        Everything you have entered, yours to take. Exports read straight from your ledger — no
        market data is fetched, so they work even when a provider is down.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="secondary" disabled={busy !== null} onClick={() => void run("csv")}>
          {busy === "csv" ? "Preparing…" : "Download transactions (CSV)"}
        </Button>
        <Button variant="secondary" disabled={busy !== null} onClick={() => void run("json")}>
          {busy === "json" ? "Preparing…" : "Download all data (JSON)"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        The CSV holds your buy, sell and dividend history, and imports into another Sage instance or
        a spreadsheet. The JSON additionally holds your custom holdings, categories, goals and
        preferences. Neither file is a backup — for disaster recovery, see the database dump
        instructions in{" "}
        <a
          href="https://github.com/bjarkeef/sage/blob/main/docs/DEPLOYMENT.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
        >
          DEPLOYMENT.md
        </a>
        .
      </p>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
