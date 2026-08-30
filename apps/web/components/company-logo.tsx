"use client";

import * as React from "react";
import Image from "next/image";

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Ordered logo sources, best quality first, each tried in turn until one loads.
 * Empty unless the operator opted in.
 *
 * Logos are the one thing on screen that can tell an outside server what you
 * hold. Drawing one means asking a third party for a named company, from your
 * browser, at your address; do it for every row and the set of requests is your
 * holdings list. So the default here is to ask nobody, and render initials.
 *
 * Setting `NEXT_PUBLIC_LOGO_DEV_TOKEN` opts in, with the cost written down in
 * `.env.example` and in the README's "How it works".
 *
 * There was a Google favicon fallback here until 2026-08-29. It needed no token
 * and had no setting to disable it, so every instance leaked that list by
 * default. It was deleted rather than gated: a second opt-in path to the same
 * disclosure is not worth the choice it offers.
 */
export function logoSources(domain: string | null, symbol: string): string[] {
  const token = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  if (!token) return [];

  const sources: string[] = [];
  if (domain) {
    sources.push(`https://img.logo.dev/${domain}?token=${token}&size=128&format=png&retina=true`);
  }
  // The ticker endpoint covers stocks AND ETFs by symbol, so it catches funds
  // and anything with no usable website (most ETFs).
  sources.push(
    `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${token}&size=128&format=png&retina=true`,
  );
  return sources;
}

interface CompanyLogoProps {
  website: string | null;
  symbol: string;
  size?: number;
}

export function CompanyLogo({ website, symbol, size = 40 }: CompanyLogoProps) {
  const domain = website ? domainFromUrl(website) : null;
  // Walk the source list on error; when exhausted, render the initials chip.
  const [sourceIndex, setSourceIndex] = React.useState(0);
  React.useEffect(() => setSourceIndex(0), [domain, symbol]);

  const sources = logoSources(domain, symbol);
  const initials = symbol.slice(0, 2);

  if (sources.length === 0 || sourceIndex >= sources.length) {
    // Decorative: every caller draws the symbol or the company name beside
    // this chip, so announcing the initials too just says the ticker twice.
    return (
      <div
        aria-hidden="true"
        className="flex items-center justify-center rounded-control bg-muted font-mono text-xs font-medium text-muted-foreground"
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
      className="flex items-center justify-center overflow-hidden rounded-control border border-border bg-white"
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
