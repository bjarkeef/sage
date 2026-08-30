# ---- base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /app

# ---- deps ----
# `pnpm fetch` populates the store from the lockfile ALONE. The previous version
# enumerated every workspace package.json by hand, which silently went stale —
# packages/providers/ecb was missing for weeks. This layer cannot miss a package,
# and still only re-runs when the lockfile changes.
FROM base AS deps
COPY pnpm-lock.yaml ./
RUN pnpm fetch

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@sage/api

# ---- runtime ----
# The build emits a single bundled dist/index.js with our own source and the
# workspace packages inlined, so the image needs neither packages/ nor the
# workspace wiring — only the npm dependencies left external by the bundler.
FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S sage && adduser -S sage -G sage

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/node_modules node_modules

# `sage` on PATH, so recovery is one readable command:
#   docker compose exec -it api sage reset-password
# A package.json "bin" entry would look right and not work — this stage copies
# dist and node_modules directly with no install step, so nothing would link it.
# Must run before USER sage: /usr/local/bin is not writable by that user.
RUN printf '#!/bin/sh\nexec node /app/apps/api/dist/cli.js "$@"\n' > /usr/local/bin/sage \
  && chmod +x /usr/local/bin/sage

USER sage
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
