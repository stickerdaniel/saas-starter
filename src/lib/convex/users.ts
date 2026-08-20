import { ConvexError, v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { components } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { authedQuery, authedMutation } from './functions';
import { appRateLimiter } from './rateLimit';
import { tables } from './betterAuth/schema';
import * as val from 'valibot';
import { passwordValidation } from '../schemas/password';

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

		// Better Auth guards setPassword with sensitiveSessionMiddleware, which only
		// bypasses the cookie cache and never checks freshness. Registering a passkey
		// in this same installation does require a fresh session, and a password is
		// the same thing: a durable second way in that outlives the session used to
		// create it. Without this, a stolen week-old OAuth session becomes permanent
		// account access. freshAge is read from the running config so it cannot drift
		// from what the passkey path enforces.
		const authCtx = await auth.$context;
		const freshAge = authCtx.sessionConfig.freshAge;
		const sessionCreatedAt = session?.session?.createdAt;
		if (!sessionCreatedAt) return { ok: false, code: 'SESSION_NOT_FRESH' };
		if (freshAge !== 0 && Date.now() - new Date(sessionCreatedAt).getTime() >= freshAge * 1000) {
			return { ok: false, code: 'SESSION_NOT_FRESH' };
		}

		// The form enforces this too, but the mutation is a public endpoint and the
		// argument validator only says "string". Better Auth checks length alone, so
		// without this the complexity rules would hold for the browser and nowhere
		// else. Cheap rejections stay ahead of the limiter: they never reach scrypt,
		// which is the work the limit exists to bound.
		if (!val.safeParse(passwordValidation, args.newPassword).success) {
			return { ok: false, code: 'PASSWORD_TOO_WEAK' };
		}
		// The shared schema has no upper bound, so without this the length rejection
		// would come back from Better Auth after the limiter had already taken a
		// token, and five pastes of an overlong password would lock the form out of
		// a correct one. Read from the running config rather than restated.
		if (args.newPassword.length > authCtx.password.config.maxPasswordLength) {
			return { ok: false, code: 'PASSWORD_TOO_LONG' };
		}

		// Answered here rather than by Better Auth, which hashes the candidate with
		// scrypt before it looks, so a caller whose account already has a password
		// could otherwise burn a hash per request.
		const credentials = await credentialAccounts(ctx, ctx.user._id);
		if (credentials.some((account) => account.password)) {
			return { ok: false, code: 'PASSWORD_ALREADY_SET' };
		}
		// A credential row without a hash is a state nothing in this installation
		// writes, and it is worth refusing rather than trusting that. Better Auth's
		// setPassword looks for a row that has a password, so it would not find this
		// one and would link a second credential row beside it; sign-in then takes
		// whichever row comes first and can land on the one that still has no hash,
		// leaving an account that reports a password it can never use. The reset
		// flow matches on providerId alone and repairs the row in place, so that is
		// where this state gets sent.
		if (credentials.length > 0) {
			return { ok: false, code: 'CREDENTIAL_ACCOUNT_UNUSABLE' };
		}

		// Bounds committed attempts. A simultaneous burst can still run one scrypt
		// hash per request before the first commit, because each transaction reads
		// the same pre-consumption limiter state; the losers then hit an OCC
		// conflict and their retries see the password and stop. The committed
		// limiter and credential state stay correct either way.
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
