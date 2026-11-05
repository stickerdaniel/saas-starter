# Self-hosted production

Run production on your own Node server, either through Coolify or as a plain Node container.

## Coolify

Use the existing Cloudflare Workers or Vercel setup for preview deployments, and run production on Coolify when you want a self-hosted Node app with the same Convex cloud backend.

**Architecture:**

- **Previews:** Cloudflare Workers or Vercel, using the existing [preview deploy flow](previews.md)
- **Production app hosting:** Coolify
- **Backend/data/auth:** Convex cloud production deployment

**Coolify setup:**

1. Add the repo as an application in Coolify and use the Nixpacks build pack
2. Set the build command to:

```bash
bunx varlock run -- bun scripts/deploy.ts
```

3. Set the start command to:

```bash
node build
```

4. Set app-level environment variables in Coolify:
   - `NODE_ADAPTER=1`
   - `PUBLIC_SITE_URL` (the public frontend origin, for canonical URLs in the server build)
   - `CONVEX_DEPLOY_KEY`
   - `TOLGEE_API_KEY` (optional)
   - `CONVEX_INTERNAL_URL` (optional, only if the app container can reach Convex through a private Docker network URL)
5. Set the required Convex production environment variables in the Convex dashboard
6. Set `SITE_URL` on the Convex production deployment to your public production domain

The build command intentionally reuses `scripts/deploy.ts` so production stays aligned with the existing deploy flow: Tolgee sync remains optional, Convex is deployed during the build, and `PUBLIC_CONVEX_URL` / `PUBLIC_CONVEX_SITE_URL` are computed automatically from the deploy output instead of being copied into Coolify by hand.

## Optional Node container

For an already provisioned Convex backend, build with `docker/node.Dockerfile`. This frontend-only build does not deploy Convex or synchronize translations. The existing Coolify/Nixpacks path above remains available.

```bash
docker build -f docker/node.Dockerfile -t starter-node \
  --build-arg APP_BUILD_SHA="$(git rev-parse HEAD)" \
  --build-arg PUBLIC_SITE_URL=https://app.example.com \
  --build-arg PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud \
  --build-arg PUBLIC_CONVEX_SITE_URL=https://your-deployment.convex.site .
docker run --rm -p 3000:3000 -e ORIGIN=https://app.example.com starter-node
```

The image runs `node build` as a non-root user. Public URLs are compiled into the frontend; rebuild to change the origin or backend. Pass private runtime settings such as `CONVEX_INTERNAL_URL` through the container environment. Keep deployment keys and other secrets out of build arguments. Configure a reverse proxy for HTTPS and set `ORIGIN` to its public origin.

Validate the production dependency tree, server modules, asset hashes and HTTP responses under Node:

```bash
docker run --rm --read-only --tmpfs /tmp \
  -v "$PWD/scripts/validate-node-runtime.ts:/probe.ts:ro" \
  --entrypoint node starter-node /probe.ts "$(git rev-parse HEAD)" https://app.example.com
```

The Node Container workflow checks native AMD64 packaging with placeholder public URLs. Those checks complement the real preview E2E suite. Dependency layers cache separately from source; font downloads still require network access.
