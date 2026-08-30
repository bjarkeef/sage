import "./globals.css";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@sage/ui";
import { Providers } from "./providers";

const geistDisplay = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--ff-display",
});

const geistBody = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--ff-body",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--ff-mono",
});

export const metadata = {
  title: "Sage",
  description: "Your portfolio, your server, your data.",
  appleWebApp: { capable: true, title: "Sage", statusBarStyle: "black-translucent" as const },
  // `appleWebApp.capable` emits only `mobile-web-app-capable`: Next deprecated
  // the apple-prefixed name in favour of the standard one. iOS Safari did not
  // follow, and still requires `apple-mobile-web-app-capable` to launch a
  // home-screen app without browser chrome. Without this line the icon and the
  // manifest are both correct and the app still opens inside Safari.
  other: { "apple-mobile-web-app-capable": "yes" },
};

/** The manifest carries one static theme colour; this carries two, so an
 *  installed Sage tints the status bar to match the scheme actually in use.
 *  Values are the resolved --background tokens, light and dark.
 *
 *  viewport-fit=cover is what puts `env(safe-area-inset-bottom)` in play — with
 *  the default, iOS letterboxes the page above the home indicator and the inset
 *  the tab bar pads by is always zero. */
export const viewport = {
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0c" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistDisplay.variable} ${geistBody.variable} ${geistMono.variable}`}
    >
      <body className="h-screen overflow-hidden bg-background font-body text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
