# syntax=docker/dockerfile:1@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
FROM oven/bun:1.4.5-debian@sha256:3dddea58e1f8f2240eca906b023fedb944f9a8352515a35309fd0c879fe00aaa AS bun
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS tools
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV HUSKY=0
COPY package.json bun.lock bunfig.toml .npmrc ./
COPY patches ./patches
# The lockfile lists each workspace; install needs its manifest, not its source.
COPY packages/eslint-plugin/package.json ./packages/eslint-plugin/package.json
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

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runtime
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
