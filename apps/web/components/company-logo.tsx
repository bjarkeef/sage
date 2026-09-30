"use client";

import * as React from "react";
import Image from "next/image";
import { useMediaPrefs } from "./media-prefs-context";

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Ordered logo sources, best quality first, each tried in turn until one loads.
 * Empty without a token, and there is only a token once the user opted in.
 *
 * Logos are one of the two things on screen that can tell an outside server
 * what you hold. Drawing one means asking a third party for a named company,
 * from your browser, at your address; do it for every row and the set of
 * requests is your holdings list. So the default here is to ask nobody, and
 * render initials.
 *
 * The opt-in is the "Company logos" switch in Settings → Privacy, off by
 * default; `useMediaPrefs()` hands `CompanyLogo` a token only while it is on.
 * `NEXT_PUBLIC_LOGO_DEV_TOKEN` can supply a default key for that switch, but no
 * longer turns anything on by itself. The cost is written down beside the
 * switch and in the README's "How it works".
 *
 * There was a Google favicon fallback here until 2026-08-29. It needed no token
 * and had no setting to disable it, so every instance leaked that list by
 * default. It was deleted rather than gated: a second opt-in path to the same
 * disclosure is not worth the choice it offers.
 */
export function logoSources(domain: string | null, symbol: string, token: string | null): string[] {
  if (!token) return [];

  const sources: string[] = [];
  if (domain) {
    sources.push(
      `https://img.logo.dev/${domain}?token=${encodeURIComponent(token)}&size=128&format=png&retina=true`,
    );
  }
  // The ticker endpoint covers stocks AND ETFs by symbol, so it catches funds
  // and anything with no usable website (most ETFs).
  sources.push(
    `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(token)}&size=128&format=png&retina=true`,
  );
  return sources;
}

interface CompanyLogoProps {
  website: string | null;
  symbol: string;
  size?: number;
}

export function CompanyLogo({ website, symbol, size = 40 }: CompanyLogoProps) {
  const { logoToken } = useMediaPrefs();
  const domain = website ? domainFromUrl(website) : null;
  // Walk the source list on error; when exhausted, render the initials chip.
  const [sourceIndex, setSourceIndex] = React.useState(0);
  React.useEffect(() => setSourceIndex(0), [domain, symbol, logoToken]);

  const sources = logoSources(domain, symbol, logoToken);
  const initials = symbol.slice(0, 2);

  if (sources.length === 0 || sourceIndex >= sources.length) {
    // Decorative: every caller draws the symbol or the company name beside
    // this chip, so announcing the initials too just says the ticker twice.
    return (
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-control bg-muted font-mono text-xs font-medium text-muted-foreground"
        style={{ width: size, height: size }}
      >
        {initials}
      </div>
    );
  }

  // Request a 128px icon regardless of display size, so downscaling to `size`
  // stays crisp on high-DPI screens.
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-control border border-border bg-white"
      style={{ width: size, height: size }}
    >
      <Image
        src={sources[sourceIndex]!}
        alt={`${symbol} logo`}
        width={size}
        height={size}
        className="object-contain p-0.5"
        unoptimized
        onError={() => setSourceIndex((i) => i + 1)}
      />
    </div>
  );
}
