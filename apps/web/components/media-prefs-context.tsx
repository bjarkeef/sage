"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { getUserSettings } from "../lib/api";
import { qk } from "../lib/query/keys";

/**
 * Whether this user's browser may ask a third party about a holding.
 *
 * Company logos (logo.dev) and news thumbnails (each publisher's image host)
 * are the only things Sage renders that make the browser request something
 * named after a holding. Both are per-user switches in Settings → Privacy, off
 * by default. `NEXT_PUBLIC_LOGO_DEV_TOKEN` can supply a default logo.dev key,
 * but only the switch turns logos on.
 */
export interface MediaPrefs {
  /** The logo.dev key to draw logos with, or null to draw initials. */
  logoToken: string | null;
  /** Whether article rows may load their publisher's thumbnail. */
  newsThumbnails: boolean;
}

export interface MediaSettings {
  showCompanyLogos: boolean;
  showNewsThumbnails: boolean;
  logoDevToken: string | null;
}

/** No provider means nothing was opted into: initials, and no images. */
const MediaPrefsContext = React.createContext<MediaPrefs>({
  logoToken: null,
  newsThumbnails: false,
});

export function resolveMediaPrefs(s: MediaSettings): MediaPrefs {
  const token = s.logoDevToken || process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN || null;
  return {
    logoToken: s.showCompanyLogos ? token : null,
    newsThumbnails: s.showNewsThumbnails,
  };
}

/** Seeded from the settings `(app)/layout.tsx` already fetched on the server,
 *  then follows the user-settings query, so a switch flipped in Settings takes
 *  effect on the next render rather than the next full load.
 *
 *  It follows without fetching (`enabled: false`). The layout has just read
 *  these values, so a fetch here would only repeat that request on every full
 *  load — and, worse, it could land before a page further down hydrates, so
 *  that page's own user-settings query renders with data on the client that the
 *  server rendered without. Settings still reaches it: its save invalidates the
 *  query, the page's own enabled observer refetches, and every observer of the
 *  key, this one included, sees the result. */
export function MediaPrefsProvider({
  initial,
  children,
}: {
  initial: MediaSettings;
  children: React.ReactNode;
}) {
  const { data } = useQuery({
    queryKey: qk.userSettings(),
    queryFn: getUserSettings,
    enabled: false,
  });
  const source = data ?? initial;
  const { showCompanyLogos, showNewsThumbnails, logoDevToken } = source;
  const value = React.useMemo(
    () => resolveMediaPrefs({ showCompanyLogos, showNewsThumbnails, logoDevToken }),
    [showCompanyLogos, showNewsThumbnails, logoDevToken],
  );
  return <MediaPrefsContext.Provider value={value}>{children}</MediaPrefsContext.Provider>;
}

export function useMediaPrefs(): MediaPrefs {
  return React.useContext(MediaPrefsContext);
}
