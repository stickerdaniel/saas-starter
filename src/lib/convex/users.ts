import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';
import { components } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { authedQuery, authedMutation } from './functions';
import { appRateLimiter } from './rateLimit';
import { createRateLimitError } from './support/types';
import { tables } from './betterAuth/schema';

/**
 * Get the currently authenticated user
 *
 * Returns the authenticated user's profile information from the session.
 * Used to check authentication status and access user data on the client.
 *
 * Throws ConvexError('Unauthenticated') when no user is signed in. Callers
 * that need a soft failure must catch (see the JWT payload fallback in
 * src/routes/+layout.server.ts).
 */
export const viewer = query({
	args: {},
	// Field validators come from the Better Auth local-install schema so the
	// returns validator stays in sync with it. User docs live in the component,
	// so _id is a plain string from the app's perspective, not v.id('user').
	returns: v.object({
		_id: v.string(),
		_creationTime: v.number(),
		...tables.user.validator.fields
	}),
	handler: async (ctx) => {
		return authComponent.getAuthUser(ctx);
	}
});

/**
 * Read the stable error code off a Better Auth APIError.
 *
 * Better Auth reports every rejection as `APIError` with `body.code` set to a
 * value from BASE_ERROR_CODES (PASSWORD_TOO_SHORT, PASSWORD_ALREADY_SET, ...).
 * Forwarding the code rather than the message lets the UI phrase the failure in
 * the user's language instead of surfacing an English string from the library.
 */
function betterAuthErrorCode(error: unknown): string {
	const code = (error as { body?: { code?: unknown } })?.body?.code;
	return typeof code === 'string' ? code : 'SET_PASSWORD_FAILED';
}

/**
 * Set a first password for the signed-in user.
 *
 * An account created through an OAuth provider has no `credential` account and
 * therefore no password at all, so `changePassword` can never succeed for it:
 * that endpoint verifies a current password that does not exist. Better Auth
 * exposes `setPassword` for exactly this case, which links the missing
 * credential account, and marks it `serverOnly` so the browser cannot reach it.
 * This mutation is that server side.
 *
 * Better Auth rejects the call with PASSWORD_ALREADY_SET once a credential
 * account exists, so this cannot overwrite a password that is already set;
 * replacing one keeps going through `authClient.changePassword`.
 */
export const setPassword = authedMutation({
	args: { newPassword: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		// Better Auth hashes the candidate with scrypt before it can decide the
		// account already has a password, so an unthrottled caller can burn CPU
		// indefinitely on a request that changes nothing.
		const status = await appRateLimiter.limit(ctx, 'setPassword', { key: ctx.user._id });
		if (!status.ok) {
			throw createRateLimitError(status.retryAfter, 'Too many password attempts');
		}

		const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

		// An impersonation session belongs to the target user, and
		// sensitiveSessionMiddleware accepts it. Minting a credential through one
		// would hand the acting admin a password that outlives the impersonation
		// and would route around the audited admin path, which is why
		// /admin/set-user-password is in DISABLED_ADMIN_PATHS in the first place.
		const session = await auth.api.getSession({ headers });
		if ((session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy) {
			throw new ConvexError({ code: 'IMPERSONATION_NOT_ALLOWED' });
		}

		try {
			await auth.api.setPassword({ body: { newPassword: args.newPassword }, headers });
		} catch (error) {
			throw new ConvexError({ code: betterAuthErrorCode(error) });
		}
		return null;
	}
});

/**
 * Whether the signed-in user has a usable password.
 *
 * Mirrors Better Auth's own test rather than merely looking for a credential
 * account: both changePassword and setPassword require `providerId` to be
 * 'credential' AND the row to carry a password hash, and the component schema
 * allows that hash to be absent. Reporting a credential row without a hash as
 * "has a password" would render the change form to an account that can only
 * ever get CREDENTIAL_ACCOUNT_NOT_FOUND back.
 *
 * Reads the caller's own account only.
 */
export const hasPassword = authedQuery({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => {
		const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'account',
			where: [
				{ field: 'userId', operator: 'eq', value: ctx.user._id },
				{ field: 'providerId', operator: 'eq', value: 'credential' }
			]
		});
		return Boolean((account as { password?: string | null } | null)?.password);
	}
});
