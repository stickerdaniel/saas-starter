# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e AS bun
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS tools
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV HUSKY=0
COPY package.json bun.lock bunfig.toml .npmrc ./
COPY patches ./patches
# Defer only source-dependent root hooks; preserve dependency lifecycle scripts.
RUN bun -e 'const p = await Bun.file("package.json").json(); delete p.scripts; await Bun.write("package.json", JSON.stringify(p));'

FROM tools AS dependencies
RUN bun install --frozen-lockfile

FROM tools AS production-dependencies
# A fresh install avoids retaining development packages from a previous layer.
RUN bun install --production --frozen-lockfile

FROM dependencies AS builder
COPY . .
ARG APP_BUILD_SHA
ARG PUBLIC_SITE_URL
ARG PUBLIC_CONVEX_URL
ARG PUBLIC_CONVEX_SITE_URL
ENV NODE_ADAPTER=1 APP_BUILD_SHA=$APP_BUILD_SHA PUBLIC_SITE_URL=$PUBLIC_SITE_URL PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL PUBLIC_CONVEX_SITE_URL=$PUBLIC_CONVEX_SITE_URL
RUN test -n "$APP_BUILD_SHA" && test -n "$PUBLIC_SITE_URL" && test -n "$PUBLIC_CONVEX_URL" && test -n "$PUBLIC_CONVEX_SITE_URL"
RUN bun run postinstall && bun run build
RUN node scripts/validate-node-runtime.ts inventory

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/build ./build
COPY --from=builder /app/runtime-inventory.json ./runtime-inventory.json
COPY --from=builder /app/runtime-imports.json ./runtime-imports.json
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "build"]
