/**
 * Better Auth admin plugin HTTP paths, split by how the app exposes them.
 *
 * The app performs admin actions through custom Convex mutations
 * (`admin/mutations.ts`) so that guards and audit-log writes are atomic with
 * the action and cannot be bypassed. The raw plugin HTTP endpoints would skip
 * both, so they are disabled at the router via Better Auth `disabledPaths`.
 * `disabledPaths` only affects HTTP routing; in-process `auth.api.*` calls
 * from those mutations keep working.
 *
 * Impersonation is the exception: it mints and restores signed session
 * cookies in the HTTP response, so it cannot run inside a Convex mutation.
 * Those two paths stay enabled and are audited by session triggers instead
 * (see `triggers.session` in `auth.ts`).
 *
 * `adminHttpPaths.test.ts` asserts both lists stay in sync with the plugin's
 * actual endpoints, so a better-auth upgrade that adds admin endpoints fails
 * the test until the new path is classified here.
 */

export const DISABLED_ADMIN_PATHS = [
	'/admin/set-role',
	'/admin/get-user',
	'/admin/create-user',
	'/admin/update-user',
	'/admin/list-users',
	'/admin/list-user-sessions',
	'/admin/unban-user',
	'/admin/ban-user',
	'/admin/revoke-user-session',
	'/admin/revoke-user-sessions',
	'/admin/remove-user',
	'/admin/set-user-password',
	'/admin/has-permission'
] as const;

export const COOKIE_BOUND_ADMIN_PATHS = [
	'/admin/impersonate-user',
	'/admin/stop-impersonating'
] as const;
