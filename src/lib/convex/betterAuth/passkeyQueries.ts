import { query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Find passkey by credentialID using index lookup
 *
 * WORKAROUND for @convex-dev/better-auth adapter bug:
 * The adapter's paginate() function incorrectly tries to use db.get() on the credentialID field,
 * treating it as a Convex document ID. But credentialIDs are base64-encoded WebAuthn credentials,
 * not base32-encoded Convex IDs, so db.get() fails with "ID wasn't valid base32".
 *
 * This query uses the credentialID index instead of db.get() for proper lookups.
 */
export const findByCredentialID = query({
	args: { credentialID: v.string() },
	handler: async (ctx, { credentialID }) => {
		return await ctx.db
			.query('passkey')
			.withIndex('credentialID', (q) => q.eq('credentialID', credentialID))
			.first();
	}
});

/**
 * List all passkeys for a user
 */
export const listByUserId = query({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		return await ctx.db
			.query('passkey')
			.withIndex('userId', (q) => q.eq('userId', userId))
			.collect();
	}
});
