# Convex backend guidance

Read `.agents/skills/convex-guidelines/SKILL.md` before writing, reviewing, or modifying any Convex query, mutation, action, schema, HTTP endpoint, auth code, storage code, or cron.

## Required verification

Run both after Convex or Convex-imported shared-code changes:

```bash
bun scripts/static-checks.ts <changed files...>
bun run check:convex
```

Generated Convex bindings may change as a local backend side effect. Revert `_generated/**` churn unless regeneration is the intended change.

## Authentication and authorization

Use the local Better Auth component. Derive identity server-side; never authorize from a caller-supplied user ID. `/app/**` and `/admin/**` route protection lives in server hooks, while every backend function still enforces its own authorization.

The public E2E helper mutations in `tests.ts` are safe only while `AUTH_E2E_TEST_SECRET` is absent from production. Never configure that variable in the production Convex environment.

## Platform and durability rules

- Scheduling from mutations is atomic; scheduled mutations execute exactly once with platform retries for internal failures.
- Scheduling from actions is not atomic, and actions execute at most once.
- `@convex-dev/resend` handles durable retry and idempotency; permanent send errors may be caught and reported.
- `@useautumn/convex` returns an error/non-data result on non-2xx and throws on network failure. State-changing entitlement gates fail closed when the answer is indeterminate.
- Convex components own isolated storage namespaces. Access component files through component APIs, not application `ctx.storage`.

When an intentional bounded `.collect()`, sequential mutation, or other normally flagged pattern is correct, add a short inline reason at the call site.

## Email

Production email uses `@convex-dev/resend`. Keep send helpers, templates, generated email output, and webhook event handling in their existing `emails/` boundaries. Use the `convexResend` btca resource for component behavior and `betterSvelteEmail` for template tooling.

## Analytics

Server analytics is best-effort and scheduled off the request path. Identify by Convex user ID, never email. Properties contain only non-PII enums, booleans, buckets, statuses, and tool names; never bodies, names, email addresses, provider IDs, URLs, search terms, or raw errors.

Prefer system-of-record tables over duplicate events. Add an event only when it has a reachable chokepoint, a downstream consumer, and a non-PII schema.

## Billing configuration

After changing `autumn.config.ts`, push the catalog explicitly:

```bash
bunx atmn push
bunx atmn push -p
```

CI preview does not update either live catalog.

## Local execution

Cloud functions use `bun convex run module:functionName '{"arg":"value"}'`. For the embedded local backend, use its HTTP query/mutation/action API with the admin key and backend URL printed by the dev server; the Convex CLI does not target that backend.
