import type { MetadataRoute } from "next";

/**
 * Installs Sage to a phone's home screen, so checking the book is a tap rather
 * than typing a host into a browser.
 *
 * `display: standalone` drops the address bar, which is what makes the bottom
 * tab bar sit where a native app's would rather than above browser chrome.
 *
 * Deliberately no service worker. Sage is self-hosted on a network the operator
 * controls, so offline caching buys nothing and costs a stale-figures problem in
 * an app whose whole value is that its numbers are current.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sage",
    short_name: "Sage",
    description: "Your portfolio, measured honestly.",
    start_url: "/",
    display: "standalone",
    // The dark ground: a single static colour, and the mark is drawn on it.
    // Per-scheme status-bar colour is handled by the viewport export in
    // layout.tsx, which the manifest cannot express.
    background_color: "#0d0d0c",
    theme_color: "#0d0d0c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
