# ---- base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/core/package.json packages/core/package.json
COPY tooling/tsconfig/package.json tooling/tsconfig/package.json
COPY tooling/eslint-config/package.json tooling/eslint-config/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
ENV SAGE_STANDALONE=true
# Next inlines NEXT_PUBLIC_* at build time, so these have to arrive as build
# args rather than runtime env vars. Both empty by default, which is what keeps
# a stock image from telling anyone what its owner holds — logo.dev for the
# companies themselves, publisher image hosts for the stories about them.
ARG NEXT_PUBLIC_LOGO_DEV_TOKEN=""
ENV NEXT_PUBLIC_LOGO_DEV_TOKEN=$NEXT_PUBLIC_LOGO_DEV_TOKEN
ARG NEXT_PUBLIC_NEWS_THUMBNAILS=""
ENV NEXT_PUBLIC_NEWS_THUMBNAILS=$NEXT_PUBLIC_NEWS_THUMBNAILS
RUN pnpm turbo run build --filter=@sage/web

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S sage && adduser -S sage -G sage

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public

USER sage
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
