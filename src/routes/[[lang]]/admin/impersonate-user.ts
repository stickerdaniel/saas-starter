import { authClient } from '#lib/auth-client.js';
import { duringAuthChange } from '#lib/analytics/client.js';
import { clearPersistedChatState } from '#lib/chat/core/chat-persisted-state.js';
import { getAuthErrorKey } from '#lib/utils/auth-messages.js';
import { localizedHref } from '#lib/utils/i18n.js';
import { normalizeSupportPageRoute } from '#lib/shared/support-page-route.js';
import { isAnonymousUser } from '#lib/convex/utils/anonymousUser.js';
import { adminReturnTarget, writeInvestigationReturn } from '#lib/admin/investigation-return.js';

/**
 * Only a registered customer has an account to sign in as, and the signed-in
 * admin has no one to impersonate in their own ticket.
 */
export function canImpersonateUser(
	targetUserId: string | undefined,
	viewerId: string | undefined
): targetUserId is string {
	return !!targetUserId && !isAnonymousUser(targetUserId) && targetUserId !== viewerId;
}

/**
 * A failure names a message key, never provider prose: Better Auth's messages
 * are English and a thrown error can carry anything.
 */
export type ImpersonationStart = { started: true } | { started: false; messageKey: string };

/**
 * Start impersonating a user and boot the app as them.
 *
 * Shared by every admin surface that offers impersonation, so each one swaps
 * the session, re-mints the JWT and drops persisted chat state the same way.
 * A successful start leaves the document, so a caller only ever has a failure
 * to report. `route` opens the app at a page the user reported from; anything
 * but a same-origin pathname falls back to the app home. Stopping later returns
 * to the admin page this was called from.
 */
export async function impersonateUser(
	userId: string,
	activeUploads?: { suspendOnce(): void } | null,
	route?: string
): Promise<ImpersonationStart> {
	// Read before the first await: the admin can move on while the request is in
	// flight, and the investigation began where they clicked.
	const returnTarget = adminReturnTarget(`${location.pathname}${location.search}`);
	try {
		// Impersonation stays on the Better Auth client (it mints session
		// cookies); its audit entries are written by session triggers.
		const result = await duringAuthChange(
			() => authClient.admin.impersonateUser({ userId }),
			(result) => !result.error
		);
		if (result.error) {
			console.error('Impersonation error:', result.error);
			return { started: false, messageKey: getAuthErrorKey(result.error) };
		}
		// Written before the refresh below: the session is already the target's,
		// so even if that read fails, a stop has to know where to return.
		writeInvestigationReturn(returnTarget);

		// Impersonation swapped the session cookie, but Better Auth's convex
		// plugin only re-mints the SSR JWT cookie on sign-in/get-session, not on
		// impersonate. Force a session read so the server issues a fresh convex_jwt
		// for the impersonated identity before we navigate, otherwise SSR resolves
		// the still-alive admin token and the app boots as the admin.
		const refreshed = await authClient.getSession({ query: { disableCookieCache: true } });
		if (refreshed.error || !refreshed.data) {
			return { started: false, messageKey: getAuthErrorKey(refreshed.error) };
		}
		// Drafts and attachments belong to the admin who wrote them, not to the
		// account this browser now speaks for.
		clearPersistedChatState();

		// Full document navigation, not a client-side goto: the app must boot with
		// the fresh JWT and new Convex subscriptions bound to the impersonated
		// identity. The session already belongs to the target, so an upload that
		// stopped this would leave the admin's page running under their identity.
		activeUploads?.suspendOnce();
		window.location.assign(normalizeSupportPageRoute(route) ?? localizedHref('/app'));
		return { started: true };
	} catch (error) {
		console.error('Impersonation error:', error);
		return { started: false, messageKey: getAuthErrorKey(error) };
	}
}
