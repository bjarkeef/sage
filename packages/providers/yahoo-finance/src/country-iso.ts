/**
 * Yahoo's `assetProfile` module reports a country as an English name —
 * `"Germany"`, `"United Kingdom"`, `"Taiwan"` — and never as a code. The
 * provider contract asks for `countryIso`, which EODHD supplies directly
 * (`CountryISO`), so the Yahoo mapper left it null.
 *
 * That single null was the whole of Sage's region gap: `countryToRegion` keys
 * on the ISO code, so on the default Yahoo path every holding resolved to
 * `Unknown` and the Diversification page's "By region" card was empty for
 * everyone. The country card worked the whole time, because it reads the name.
 *
 * Names here are the ones Yahoo actually returns, sampled against live
 * responses rather than taken from the ISO register — Yahoo says
 * `"South Korea"`, not `"Korea, Republic of"`. Aliases cover the spellings a
 * different Yahoo endpoint or a future change might use.
 *
 * An unrecognised name yields null, which reads as `Unknown` downstream. That
 * is deliberate: a wrong region is worse than an absent one, and `Unknown` is a
 * bucket this app already shows in plain sight rather than hiding.
 */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // Verified against live Yahoo responses
  "united states": "US",
  canada: "CA",
  "united kingdom": "GB",
  germany: "DE",
  switzerland: "CH",
  netherlands: "NL",
  japan: "JP",
  australia: "AU",
  taiwan: "TW",

  // Remaining countries the region map knows about
  france: "FR",
  sweden: "SE",
  denmark: "DK",
  norway: "NO",
  italy: "IT",
  spain: "ES",
  finland: "FI",
  belgium: "BE",
  austria: "AT",
  ireland: "IE",
  portugal: "PT",
  poland: "PL",
  "hong kong": "HK",
  singapore: "SG",
  "south korea": "KR",
  china: "CN",
  india: "IN",
  "new zealand": "NZ",
  brazil: "BR",
  mexico: "MX",
  chile: "CL",
  argentina: "AR",
  colombia: "CO",
  "south africa": "ZA",
  nigeria: "NG",
  egypt: "EG",
  kenya: "KE",
  "saudi arabia": "SA",
  "united arab emirates": "AE",
  israel: "IL",
  qatar: "QA",
  kuwait: "KW",
  luxembourg: "LU",
  greece: "GR",
  czechia: "CZ",
  hungary: "HU",

  // Aliases for the same places, in case a different endpoint spells them out
  "united states of america": "US",
  usa: "US",
  "great britain": "GB",
  "korea, republic of": "KR",
  "republic of korea": "KR",
  "czech republic": "CZ",
  "hong kong sar china": "HK",
  "united arab emirates (uae)": "AE",
};

/** Resolve Yahoo's English country name to an ISO 3166-1 alpha-2 code, or null
 *  when the name is absent or not one we recognise. */
export function countryNameToIso(name: string | null | undefined): string | null {
  if (!name) return null;
  return COUNTRY_NAME_TO_ISO[name.trim().toLowerCase()] ?? null;
}
