/** Yahoo fund sectorWeightings keys → the sector labels stock profiles use.
 *  Both spellings of real estate appear in the wild. Keys are matched after
 *  lowercasing and collapsing spaces to underscores, so canonical labels
 *  ("Real Estate") round-trip to themselves. */
const FUND_SECTOR_LABELS: Record<string, string> = {
  realestate: "Real Estate",
  real_estate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

export function canonicalSectorLabel(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  const mapped = FUND_SECTOR_LABELS[key];
  if (mapped) return mapped;
  return raw
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
