"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Callout, Card, Field, Switch, Input } from "@sage/ui";
import { createCustomHolding, getCustomHolding, updateCustomHolding } from "../lib/api";
import { invalidateFor } from "../lib/query/invalidation";
import { qk } from "../lib/query/keys";
import type { CustomHoldingIncomeInput, CustomHoldingInput } from "../lib/types";

const HOLDING_TYPES = [
  { label: "Savings", value: "savings" },
  { label: "Pension", value: "pension" },
  { label: "Other", value: "other" },
] as const;

const FREQUENCY_UNITS = [
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Quarter", value: "quarter" },
  { label: "Year", value: "year" },
] as const;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function blankToNull(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

const selectClass = "h-9 w-full rounded-control border border-border bg-transparent px-3 text-sm";
const textareaClass =
  "w-full rounded-control border border-border bg-transparent px-3 py-2 text-sm";

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export interface CustomHoldingFormProps {
  mode: "create" | "edit";
  symbol?: string;
}

export function CustomHoldingForm({ mode, symbol }: CustomHoldingFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: existing } = useQuery({
    queryKey: qk.customHolding(symbol ?? ""),
    queryFn: () => getCustomHolding(symbol as string),
    enabled: mode === "edit" && !!symbol,
  });

  const [ticker, setTicker] = React.useState("");
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState("");
  const [holdingType, setHoldingType] = React.useState<"savings" | "pension" | "other">("savings");
  const [sector, setSector] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [note, setNote] = React.useState("");

  const [incomeEnabled, setIncomeEnabled] = React.useState(false);
  const [yearlyPct, setYearlyPct] = React.useState("");
  const [frequencyUnit, setFrequencyUnit] = React.useState<"week" | "month" | "quarter" | "year">(
    "year",
  );
  const [frequencyInterval, setFrequencyInterval] = React.useState("1");
  const [firstPaymentDate, setFirstPaymentDate] = React.useState("");
  const [lastPaymentDate, setLastPaymentDate] = React.useState("");
  const [reinvest, setReinvest] = React.useState(false);
  const [autoAdd, setAutoAdd] = React.useState(true);

  const [initialDate, setInitialDate] = React.useState(todayISO());
  const [initialPrice, setInitialPrice] = React.useState("1");

  const [error, setError] = React.useState<string | null>(null);

  // Prefill from the fetched holding exactly once — later refetches (e.g. after
  // an unrelated invalidation) must not clobber in-flight edits.
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (!existing || prefilled.current) return;
    prefilled.current = true;
    setName(existing.name);
    setCurrency(existing.currency);
    setHoldingType(existing.holdingType);
    setSector(existing.sector ?? "");
    setCountry(existing.country ?? "");
    setNote(existing.note ?? "");
    if (existing.income) {
      setIncomeEnabled(true);
      setYearlyPct(existing.income.yearlyPct);
      setFrequencyUnit(existing.income.frequencyUnit);
      setFrequencyInterval(String(existing.income.frequencyInterval));
      setFirstPaymentDate(existing.income.firstPaymentDate);
      setLastPaymentDate(existing.income.lastPaymentDate ?? "");
      setReinvest(existing.income.reinvest);
      setAutoAdd(existing.income.autoAdd);
    }
  }, [existing]);

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const income: CustomHoldingIncomeInput | null = incomeEnabled
        ? {
            yearlyPct,
            frequencyUnit,
            frequencyInterval: Number(frequencyInterval) || 1,
            firstPaymentDate,
            lastPaymentDate: blankToNull(lastPaymentDate),
            reinvest,
            autoAdd,
          }
        : null;

      if (mode === "create") {
        const input: CustomHoldingInput = {
          symbol: ticker.trim().toUpperCase(),
          name: name.trim(),
          currency: currency.trim().toUpperCase(),
          holdingType,
          sector: blankToNull(sector),
          country: blankToNull(country),
          note: blankToNull(note),
          initialPrice:
            initialPrice.trim() === "" ? null : { date: initialDate, price: initialPrice.trim() },
          income,
        };
        const result = await createCustomHolding(input);
        return result.symbol;
      }

      if (!symbol) throw new Error("Missing symbol for edit.");
      await updateCustomHolding(symbol, {
        name: name.trim(),
        holdingType,
        sector: blankToNull(sector),
        country: blankToNull(country),
        note: blankToNull(note),
        income,
      });
      return symbol;
    },
    onSuccess: async (savedSymbol) => {
      await invalidateFor(queryClient, "holdings");
      router.push(`/asset/${encodeURIComponent(savedSymbol)}`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not save the custom holding.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  const submitting = mutation.isPending;

  return (
    <Card compact className="max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {mode === "create" && (
          <Field label="Ticker" htmlFor="holding-ticker">
            <Input
              id="holding-ticker"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="E.G. CASH_DKK"
            />
          </Field>
        )}

        <Field label="Name" htmlFor="holding-name">
          <Input id="holding-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Currency" htmlFor="holding-currency">
              <Input
                id="holding-currency"
                value={currency}
                maxLength={3}
                disabled={mode === "edit"}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                placeholder="DKK"
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Holding type" htmlFor="holding-type">
              <select
                id="holding-type"
                value={holdingType}
                onChange={(e) => setHoldingType(e.target.value as typeof holdingType)}
                className={selectClass}
              >
                {HOLDING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Sector" htmlFor="holding-sector">
              <Input
                id="holding-sector"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Country" htmlFor="holding-country">
              <Input
                id="holding-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <Field label="Note" htmlFor="holding-note">
          <textarea
            id="holding-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={textareaClass}
          />
        </Field>

        <ToggleRow
          label="Brings steady income"
          description="Track a recurring payment (interest, pension distribution) on a fixed cadence."
          checked={incomeEnabled}
          onCheckedChange={setIncomeEnabled}
        />

        {incomeEnabled && (
          <div className="flex flex-col gap-4 border-t border-hairline pt-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <Field label="Yearly %" htmlFor="holding-yearly-pct">
                  <Input
                    id="holding-yearly-pct"
                    inputMode="decimal"
                    value={yearlyPct}
                    onChange={(e) => setYearlyPct(e.target.value)}
                    placeholder="4.25"
                  />
                </Field>
              </div>
              <div className="flex-1">
                <Field label="Frequency" htmlFor="holding-frequency-unit">
                  <select
                    id="holding-frequency-unit"
                    value={frequencyUnit}
                    onChange={(e) => setFrequencyUnit(e.target.value as typeof frequencyUnit)}
                    className={selectClass}
                  >
                    {FREQUENCY_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="w-20">
                <Field label="Every" htmlFor="holding-interval">
                  <Input
                    id="holding-interval"
                    type="number"
                    min={1}
                    value={frequencyInterval}
                    onChange={(e) => setFrequencyInterval(e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <Field label="First payment" htmlFor="holding-first-payment">
                  <Input
                    id="holding-first-payment"
                    type="date"
                    value={firstPaymentDate}
                    onChange={(e) => setFirstPaymentDate(e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex-1">
                <Field label="Last payment (optional)" htmlFor="holding-last-payment">
                  <Input
                    id="holding-last-payment"
                    type="date"
                    value={lastPaymentDate}
                    onChange={(e) => setLastPaymentDate(e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <ToggleRow label="Reinvest" checked={reinvest} onCheckedChange={setReinvest} />
            <ToggleRow
              label="Add automatically"
              description="Post each payment as a dividend transaction on its due date."
              checked={autoAdd}
              onCheckedChange={setAutoAdd}
            />
          </div>
        )}

        {mode === "create" && (
          <div className="flex gap-3 border-t border-hairline pt-4">
            <div className="flex-1">
              <Field label="Initial price date" htmlFor="holding-initial-date">
                <Input
                  id="holding-initial-date"
                  type="date"
                  value={initialDate}
                  onChange={(e) => setInitialDate(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field
                label="Initial price"
                htmlFor="holding-initial-price"
                hint="Savings accounts: keep 1.00 so shares equal the balance."
              >
                <Input
                  id="holding-initial-price"
                  inputMode="decimal"
                  value={initialPrice}
                  onChange={(e) => setInitialPrice(e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}

        {error && <Callout tone="error">{error}</Callout>}

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : mode === "create" ? "Create holding" : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => router.push("/holdings")}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
