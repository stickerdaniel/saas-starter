# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b AS bun
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS tools
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

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
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
