import { ConvexError, v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { components } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { authedQuery, authedMutation } from './functions';
import { appRateLimiter } from './rateLimit';
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

/** Codes Better Auth raises deterministically for a bad request rather than a fault. */
const EXPECTED_SET_PASSWORD_CODES = new Set([
	'PASSWORD_ALREADY_SET',
	'PASSWORD_TOO_SHORT',
	'PASSWORD_TOO_LONG'
]);

/** Credential accounts belonging to a user, as Better Auth itself counts them. */
async function credentialAccounts(
	ctx: Pick<QueryCtx, 'runQuery'>,
	userId: string
): Promise<Array<{ password?: string | null }>> {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'account',
		where: [
			{ field: 'userId', operator: 'eq', value: userId },
			{ field: 'providerId', operator: 'eq', value: 'credential' }
		],
		paginationOpts: { cursor: null, numItems: 200 }
	});
	return result.page as Array<{ password?: string | null }>;
}

/**
 * Set a first password for the signed-in user.
 *
 * An account created through an OAuth provider has no `credential` account and
 * therefore no password at all, so `changePassword` can never succeed for it:
 * that endpoint verifies a current password that does not exist. Better Auth
 * exposes `setPassword` for exactly this case, which links the missing
 * credential account, and marks it server-only so the browser cannot reach it.
 * This mutation is that server side.
 *
 * Expected rejections are returned rather than thrown. A throw would roll the
 * whole mutation back, and the rate limiter is transactional, so every rejected
 * attempt would hand its token back and the limit below would count nothing.
 */
export const setPassword = authedMutation({
	args: { newPassword: v.string() },
	returns: v.object({
		ok: v.boolean(),
		code: v.optional(v.string()),
		retryAfter: v.optional(v.number())
	}),
	handler: async (ctx, args) => {
		const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

		// An impersonation session belongs to the target user, and
		// sensitiveSessionMiddleware accepts it. Minting a credential through one
		// would hand the acting admin a password that outlives the impersonation
		// and would route around the audited admin path, which is why
		// /admin/set-user-password is in DISABLED_ADMIN_PATHS in the first place.
		// Checked before the limiter so a rejected admin cannot spend the target's
		// allowance.
		const session = await auth.api.getSession({ headers });
		if ((session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy) {
			return { ok: false, code: 'IMPERSONATION_NOT_ALLOWED' };
		}

		// Answered here rather than by Better Auth, which hashes the candidate with
		// scrypt before it looks, so a caller whose account already has a password
		// could otherwise burn a hash per request.
		if ((await credentialAccounts(ctx, ctx.user._id)).some((account) => account.password)) {
			return { ok: false, code: 'PASSWORD_ALREADY_SET' };
		}

		const status = await appRateLimiter.limit(ctx, 'setPassword', { key: ctx.user._id });
		if (!status.ok) {
			return { ok: false, code: 'RATE_LIMITED', retryAfter: status.retryAfter };
		}

		try {
			await auth.api.setPassword({ body: { newPassword: args.newPassword }, headers });
		} catch (error) {
			const code = betterAuthErrorCode(error);
			// Anything unexpected is a fault, not a verdict: let it roll the
			// mutation back so no half-applied state or spent token survives.
			if (!EXPECTED_SET_PASSWORD_CODES.has(code)) throw new ConvexError({ code });
			return { ok: false, code };
		}
		return { ok: true };
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
		return (await credentialAccounts(ctx, ctx.user._id)).some((account) => account.password);
	}
});
