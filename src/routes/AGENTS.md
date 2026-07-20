# Route and rendering guidance

## Rendering choices

- Prerender public marketing/legal pages that have no request-time dependency.
- Use SSR for authenticated and dynamic routes.
- Keep user-specific Convex data client-side and reactive; do not add server waterfalls merely to avoid loading states.
- Pass SSR-known auth/session data through layout data where it materially improves first paint.
- Use SvelteKit remote functions for one-shot server operations; use Convex clients for realtime, optimistic, high-frequency, or streaming interactions.

When a route serves different representations based on `Accept`, keep the worker patch and negotiated-content tests aligned. Marketing cache behavior is enforced in hooks/build scripts; update the relevant regression guard rather than documenting a new current-state file list.

## Forms

Use this decision order:

1. Better Auth/session-sensitive flows use the existing client `authClient` pattern.
2. Realtime, streaming, high-frequency, and optimistic interactions use Convex client mutations/actions.
3. One-shot server mutations with schema validation use SvelteKit remote `form()` with Valibot.
4. Existing presigned/pre-upload flows keep file transfer client-side and submit final metadata separately.

Use `Field.Group` and `Field.Field` from the shared field components. Keep field errors next to their inputs, avoid redundant error messages, and do not override `Field.Group` spacing with local gap/margin/padding utilities. For remote-form implementation details, load `.agents/skills/svelte-form-builder/SKILL.md`.

## Navigation and loading

Use route-level deferred loading only for non-critical data. Avoid a first-paint flash when state is SSR-visible. Runed `useSearchParams` is appropriate for client-only or flash-invisible URL state; use SvelteKit page URL state when the initial render must reflect the query.

View transitions must skip same-path query churn, slow navigations, and reduced-motion users. Keep transition behavior in the shared layout rather than reproducing it per page.
