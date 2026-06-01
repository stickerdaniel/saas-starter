# Run the e2e tests

## Default — isolated local stack

```
bun run test:e2e
```

Spawns `bun run dev:test`, which boots an isolated local Convex backend on a separate
state dir (`.convex/<branch>...e2e-<hash>/`) and a deterministic per-project vite test
port (see `scripts/dev-ports.ts`). Safe to run alongside `bun run dev`. Requires
`AUTH_E2E_TEST_SECRET` in `.env.test`. See
`AGENTS.md` → Testing Guidelines → "Local e2e isolation".

## Targeting a developer-managed deployment

To point the suite at a CF preview, staging environment, or your own remote Convex
deployment instead of the isolated local stack:

```
E2E_OVERRIDE_SITE_URL=https://your-preview.example.com \
PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud \
bun run test:e2e
```

When `E2E_OVERRIDE_SITE_URL` is set, playwright skips the local `dev:test` webServer,
`baseURL`/`SITE_URL` use the override, and the Convex resolver falls through to
`PUBLIC_CONVEX_URL` (the local `.test-backend-url` file is ignored). Make sure
`AUTH_E2E_TEST_SECRET` in `.env.test` matches the secret on the target backend.
