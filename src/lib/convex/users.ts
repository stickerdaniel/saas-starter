import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';
import { components } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { authedQuery, authedMutation } from './functions';
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
		const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
		try {
			await auth.api.setPassword({ body: { newPassword: args.newPassword }, headers });
		} catch (error) {
			throw new ConvexError({ code: betterAuthErrorCode(error) });
		}
		return null;
	}
});

/**
 * Whether the signed-in user has a password.
 *
 * The settings card needs this before first paint so it can render the change
 * form or the set form directly, without briefly showing a current-password
 * field to an account that has no password to state. Reads the caller's own
 * accounts only.
 */
export const hasPassword = authedQuery({
	args: {},
	returns: v.boolean(),
	handler: async (ctx) => {
		const accounts = await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'account',
			where: [{ field: 'userId', operator: 'eq', value: ctx.user._id }],
			paginationOpts: { cursor: null, numItems: 200 }
		});
		return (accounts.page as Array<{ providerId?: string }>).some(
			(account) => account.providerId === 'credential'
		);
	}
});
