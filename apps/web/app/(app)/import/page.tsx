"use client";

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import {
  Button,
  Callout,
  Card,
  Chip,
  Input,
  PageHeader,
  PageShell,
  SegmentedControl,
  Stat,
  StatStrip,
} from "@sage/ui";
import {
  previewSnowballImport,
  commitSnowballImport,
  inspectCsvImport,
  previewCsvImport,
  commitCsvImport,
  type ColumnMappingDTO,
  type CsvInspectDTO,
} from "@/lib/api";
import { invalidateFor } from "@/lib/query/invalidation";
import { formatDate } from "@/lib/format";
import type { ImportPreviewDTO, ImportResultDTO, ImportTransactionDTO } from "@/lib/types";

type Format = "snowball" | "generic";
type Step = "upload" | "map" | "review" | "done";

const MAP_FIELDS: {
  key: keyof ColumnMappingDTO;
  label: string;
  required?: boolean;
  optionalCol?: boolean;
}[] = [
  { key: "tradeDate", label: "Trade date", required: true },
  { key: "symbol", label: "Symbol / ticker", required: true },
  { key: "type", label: "Type (buy/sell/…)", required: true },
  { key: "quantity", label: "Quantity", required: true },
  { key: "price", label: "Price", required: true },
  { key: "currency", label: "Currency", required: true },
  { key: "fee", label: "Fee", optionalCol: true },
  { key: "feeCurrency", label: "Fee currency", optionalCol: true },
  { key: "exchange", label: "Exchange", optionalCol: true },
  { key: "name", label: "Name", optionalCol: true },
];

function emptyMapping(): ColumnMappingDTO {
  return {
    tradeDate: "",
    symbol: "",
    type: "",
    quantity: "",
    price: "",
    currency: "",
    fee: null,
    feeCurrency: null,
    exchange: null,
    name: null,
    defaultCurrency: null,
    defaultExchange: null,
    dateFormat: "auto",
  };
}

function mergeSuggested(s: Partial<ColumnMappingDTO>): ColumnMappingDTO {
  return {
    ...emptyMapping(),
    ...s,
    fee: s.fee ?? null,
    feeCurrency: s.feeCurrency ?? null,
    exchange: s.exchange ?? null,
    name: s.name ?? null,
    dateFormat: s.dateFormat ?? "auto",
  };
}

export default function ImportPage() {
  const queryClient = useQueryClient();
  // Generic first. Snowball was the default because it was built first, so
  // someone arriving from any other broker met an importer named after a
  // competitor and a drop zone asking for "Snowball Analytics export (.csv)".
  // The generic path is also the stronger one — its column detection reads an
  // ordinary broker export unaided.
  const [format, setFormat] = useState<Format>("generic");
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<CsvInspectDTO | null>(null);
  const [mapping, setMapping] = useState<ColumnMappingDTO>(emptyMapping());
  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [result, setResult] = useState<ImportResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoreDeleted, setRestoreDeleted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(f: File) {
    setFile(f);
    setError(null);
    setLoading(true);
    try {
      if (format === "snowball") {
        const data = await previewSnowballImport(f);
        setPreview(data);
        setStep("review");
      } else {
        const data = await inspectCsvImport(f);
        setInspect(data);
        setMapping(mergeSuggested(data.suggestedMapping));
        setStep("map");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleMappingContinue() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const data = await previewCsvImport(file, mapping);
      setPreview(data);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const data =
        format === "snowball"
          ? await commitSnowballImport(file, restoreDeleted)
          : await commitCsvImport(file, mapping, restoreDeleted);
      setResult(data);
      setStep("done");
      await invalidateFor(queryClient, "import");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setStep("upload");
    setFile(null);
    setInspect(null);
    setMapping(emptyMapping());
    setPreview(null);
    setResult(null);
    setError(null);
    setRestoreDeleted(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const mappingReady =
    mapping.tradeDate &&
    mapping.symbol &&
    mapping.type &&
    mapping.quantity &&
    mapping.price &&
    mapping.currency;

  return (
    <PageShell className="py-10">
      <PageHeader
        title="Import Portfolio"
        description="Bring in your transactions from any broker's CSV export — you map the columns — or from a Snowball Analytics export."
      />

      {error && (
        <Callout tone="error" className="mt-4">
          {error}
        </Callout>
      )}

      {step === "upload" && (
        <div className="mt-6 space-y-4">
          <SegmentedControl
            value={format}
            onChange={(v) => setFormat(v as Format)}
            options={[
              { value: "generic", label: "Any broker CSV" },
              { value: "snowball", label: "Snowball" },
            ]}
          />
          <label
            htmlFor="csv-upload"
            className="flex cursor-pointer flex-col items-center rounded-card border-2 border-dashed border-hairline px-6 py-10 transition-colors hover:border-ring hover:bg-surface-hover"
          >
            <span className="text-sm font-medium">
              {loading ? "Processing..." : "Drop CSV file here or click to browse"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {format === "snowball"
                ? "Snowball Analytics export (.csv)"
                : "Any CSV with trade rows — you will map columns next"}
            </span>
            <input
              ref={inputRef}
              id="csv-upload"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileSelect(f);
              }}
            />
          </label>
        </div>
      )}

      {step === "map" && inspect && (
        <div className="mt-6 space-y-4">
          <Callout>
            <p className="text-sm">
              {inspect.rowCount} data rows. Map each Sage field to a column. Type values accept
              buy/sell/dividend/split (case-insensitive).
            </p>
          </Callout>

          <Card className="space-y-3 p-5">
            {MAP_FIELDS.map((f) => (
              <label key={f.key} className="grid grid-cols-[160px_1fr] items-center gap-3 text-sm">
                <span className="text-muted-foreground">
                  {f.label}
                  {f.required ? " *" : ""}
                </span>
                <select
                  className="rounded-control border border-hairline bg-surface-active px-3 py-2 text-sm"
                  value={String(mapping[f.key] ?? "")}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setMapping((m) => ({ ...m, [f.key]: v }));
                  }}
                >
                  <option value="">
                    {f.optionalCol || !f.required ? "— none —" : "Select column…"}
                  </option>
                  {inspect.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            <label className="grid grid-cols-[160px_1fr] items-center gap-3 text-sm">
              <span className="text-muted-foreground">Date format</span>
              <select
                className="rounded-control border border-hairline bg-surface-active px-3 py-2 text-sm"
                value={mapping.dateFormat ?? "auto"}
                onChange={(e) =>
                  setMapping((m) => ({
                    ...m,
                    dateFormat: e.target.value as ColumnMappingDTO["dateFormat"],
                  }))
                }
              >
                <option value="auto">Auto (ISO, then D/M/Y, then M/D/Y)</option>
                <option value="iso">ISO (YYYY-MM-DD)</option>
                <option value="dmy">D/M/Y</option>
                <option value="mdy">M/D/Y</option>
              </select>
            </label>

            <label className="grid grid-cols-[160px_1fr] items-center gap-3 text-sm">
              <span className="text-muted-foreground">Default currency</span>
              <Input
                placeholder="e.g. EUR when column empty"
                maxLength={3}
                value={mapping.defaultCurrency ?? ""}
                onChange={(e) =>
                  setMapping((m) => ({
                    ...m,
                    defaultCurrency: e.target.value.trim().toUpperCase() || null,
                  }))
                }
              />
            </label>
          </Card>

          {inspect.sampleRows.length > 0 && (
            <ExpandableSection title="Sample rows" defaultOpen>
              <div className="max-h-40 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-hairline">
                    <tr>
                      {inspect.headers.map((h) => (
                        <th key={h} className="label-caps py-1 pr-2 text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline-faint">
                    {inspect.sampleRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {inspect.headers.map((h) => (
                          <td key={h} className="py-1 pr-2 tabular-nums">
                            {row[h] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExpandableSection>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => void handleMappingContinue()}
              disabled={loading || !mappingReady}
            >
              {loading ? "Previewing…" : "Preview import"}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={loading}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "review" && preview && (
        <div className="mt-6 space-y-4">
          <StatStrip>
            <Stat size="sm" label="Buys" value={preview.summary.buys} />
            <Stat size="sm" label="Sells" value={preview.summary.sells} />
            <Stat size="sm" label="Dividends" value={preview.summary.dividends} />
            <Stat size="sm" label="Splits" value={preview.summary.splits} />
            <Stat size="sm" label="Skipped" value={preview.summary.skipped} />
            <Stat size="sm" label="New tickers" value={preview.summary.newInstruments} />
          </StatStrip>

          {preview.warnings.length > 0 && (
            <Callout>
              {preview.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </Callout>
          )}

          {preview.transactions.length > 0 && (
            <ExpandableSection title={`Transactions (${preview.transactions.length})`} defaultOpen>
              <TransactionTable rows={preview.transactions} />
            </ExpandableSection>
          )}

          {preview.skipped.length > 0 && (
            <ExpandableSection title={`Skipped (${preview.skipped.length})`}>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-hairline">
                    <tr>
                      <th className="label-caps py-1.5 pr-3 text-muted-foreground">Symbol</th>
                      <th className="label-caps py-1.5 pr-3 text-muted-foreground">Event</th>
                      <th className="label-caps py-1.5 text-muted-foreground">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline-faint">
                    {preview.skipped.map((s, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-3 font-medium">{s.symbol}</td>
                        <td className="py-1.5 pr-3">{s.event}</td>
                        <td className="py-1.5 text-muted-foreground">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ExpandableSection>
          )}

          {preview.deleted.length > 0 && (
            <ExpandableSection title={`Previously deleted (${preview.deleted.length})`}>
              <TransactionTable rows={preview.deleted} />
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={restoreDeleted}
                  onChange={(e) => setRestoreDeleted(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Restore these transactions
                  <span className="block text-xs text-muted-foreground">
                    These rows were imported before and later deleted in Sage. Leave unchecked to
                    keep them deleted.
                  </span>
                </span>
              </label>
            </ExpandableSection>
          )}

          {preview.instruments.length > 0 && (
            <ExpandableSection title={`New instruments (${preview.instruments.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {preview.instruments.map((inst) => (
                  <Chip key={inst.symbol} variant="outline">
                    {inst.symbol} ({inst.exchange})
                  </Chip>
                ))}
              </div>
            </ExpandableSection>
          )}

          {(() => {
            const importCount =
              preview.transactions.length + (restoreDeleted ? preview.deleted.length : 0);
            return (
              <div className="flex gap-3 pt-2">
                <Button onClick={() => void handleCommit()} disabled={loading || importCount === 0}>
                  {loading ? "Importing..." : `Import ${importCount} transactions`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (format === "generic") setStep("map");
                    else handleReset();
                  }}
                  disabled={loading}
                >
                  {format === "generic" ? "Back to mapping" : "Cancel"}
                </Button>
              </div>
            );
          })()}
        </div>
      )}

      {step === "done" && result && (
        <div className="mt-6 space-y-4">
          <Callout tone="success">
            <p className="text-sm font-medium text-gain">Import complete</p>
            <ul className="mt-2 space-y-1 text-sm text-gain">
              <li>{result.inserted} transactions imported</li>
              {result.restored > 0 && <li>{result.restored} deleted transactions restored</li>}
              {result.claimedExisting > 0 && (
                <li>
                  {result.claimedExisting} matched transactions you&apos;d already entered — linked,
                  not duplicated
                </li>
              )}
              <li>{result.instrumentsCreated} new instruments created</li>
              {result.skippedDuplicates > 0 && (
                <li>{result.skippedDuplicates} duplicates skipped</li>
              )}
            </ul>
          </Callout>
          <Button variant="outline" onClick={handleReset}>
            Import another file
          </Button>
        </div>
      )}
    </PageShell>
  );
}

function TransactionTable({ rows }: { rows: ImportTransactionDTO[] }) {
  return (
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-hairline">
          <tr>
            <th className="label-caps py-1.5 pr-3 text-muted-foreground">Date</th>
            <th className="label-caps py-1.5 pr-3 text-muted-foreground">Symbol</th>
            <th className="label-caps py-1.5 pr-3 text-muted-foreground">Type</th>
            <th className="label-caps py-1.5 pr-3 text-right text-muted-foreground">Qty</th>
            <th className="label-caps py-1.5 pr-3 text-right text-muted-foreground">Price</th>
            <th className="label-caps py-1.5 text-right text-muted-foreground">Fee</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-faint">
          {rows.map((tx, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-3 tabular-nums">
                {formatDate(tx.tradeDate, { year: "always" })}
              </td>
              <td className="py-1.5 pr-3 font-medium">{tx.symbol}</td>
              <td className="py-1.5 pr-3 capitalize">{tx.type}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{tx.quantity}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">
                {tx.price} {tx.currency}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {tx.fee ? `${tx.fee} ${tx.feeCurrency}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpandableSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="p-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-card px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-surface-hover"
      >
        {title}
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-hairline-faint px-4 py-3">{children}</div>}
    </Card>
  );
}
