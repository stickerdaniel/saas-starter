/**
 * /app re-resolves the auth-coupled root data on client-side navigation
 * because client-side navigation can retain a stale root layout with an
 * unauthenticated snapshot. Full rationale on authedSubtreeLayoutLoad in
 * $lib/server/auth-layout-data; shared with /admin so the guards cannot
 * diverge.
 */
export { authedSubtreeLayoutLoad as load } from '$lib/server/auth-layout-data';
