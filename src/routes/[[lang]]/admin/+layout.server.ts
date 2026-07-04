/**
 * /admin re-resolves the auth-coupled root data on client-side navigation
 * because marketing pages prerender the root layout with a frozen
 * unauthenticated snapshot. Full rationale on authedSubtreeLayoutLoad in
 * $lib/server/auth-layout-data; shared with /app so the guards cannot
 * diverge.
 */
export { authedSubtreeLayoutLoad as load } from '$lib/server/auth-layout-data';
