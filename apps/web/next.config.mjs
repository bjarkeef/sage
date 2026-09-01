/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Docker image needs Next's `standalone` output (self-contained server).
  // It relies on symlinks that fail on Windows without Developer Mode, so it is
  // opt-in via env: enabled in CI/Docker builds, off for local dev/build.
  output: process.env.SAGE_STANDALONE === "true" ? "standalone" : undefined,
  transpilePackages: ["@sage/ui"],
  // Next's dev badge is pinned to the bottom of the viewport, which is exactly
  // where the phone's tab bar now lives — on a 375px screen it sits on top of
  // the navigation. Nothing is lost: it reports compile status that the
  // terminal already prints.
  devIndicators: false,
  // Next 16 writes its own apps/web/AGENTS.md and apps/web/CLAUDE.md on dev
  // start. This repo authors both at the root, and a generated pair one level
  // down contradicts them — and lands as untracked files in every
  // contributor's first `git status`.
  agentRules: false,
  images: {
    // logo.dev only, and only reachable at all when the operator sets
    // NEXT_PUBLIC_LOGO_DEV_TOKEN. The Google favicon host was removed with the
    // ungated fallback that used it (see components/company-logo.tsx).
    remotePatterns: [{ protocol: "https", hostname: "img.logo.dev" }],
  },
};

export default nextConfig;
