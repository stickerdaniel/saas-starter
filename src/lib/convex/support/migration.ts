import { mutation } from '../_generated/server';
import { v, ConvexError } from 'convex/values';
import { authComponent } from '../auth';
import { isAnonymousUser } from '../utils/anonymousUser';
import { supportAgent } from './agent';

/**
 * Migrate anonymous support tickets to an authenticated user account.
 *
 * Called from the client when a user logs in or signs up while having
 * anonymous support tickets stored in localStorage.
 *
 * This mutation:
 * 1. Verifies the caller is authenticated
 * 2. Validates the anonymous user ID format
 * 3. Finds all supportThreads belonging to the anonymous user
 * 4. Updates both agent:threads and supportThreads with the authenticated userId
 * 5. Enriches threads with user profile data (name, email)
 *
 * @security Only authenticated users can call this mutation.
 *           The anonymous ID must have valid anon_ prefix.
 *           Migration is atomic (via Convex mutation transactions) - all threads migrate or none do.
 */
export const migrateAnonymousTickets = mutation({
	args: { anonymousUserId: v.string() },
	returns: v.object({ migratedCount: v.number() }),
	handler: async (ctx, args) => {
		// 1. Verify caller is authenticated
		const authUser = await authComponent.getAuthUser(ctx);
		if (!authUser) {
			throw new ConvexError('Authentication required');
		}

		// 2. Validate anonymous ID format
		if (!isAnonymousUser(args.anonymousUserId)) {
			throw new ConvexError('Invalid anonymous user ID');
		}

		const supportThreads = await ctx.db
			.query('supportThreads')
			.withIndex('by_user', (q) => q.eq('userId', args.anonymousUserId))
			.collect();

		if (supportThreads.length === 0) {
			return { migratedCount: 0 };
		}

		// Extract auth data for use in loop
		const { _id: authUserId, name: authUserName, email: authUserEmail } = authUser;

		// 4. Update each thread
		for (const supportThread of supportThreads) {
			if (supportThread.isWarm) {
				try {
					await supportAgent.deleteThreadAsync(ctx, { threadId: supportThread.threadId });
				} catch (error) {
					console.log(
						`[migrateAnonymousTickets] Failed to delete warm thread ${supportThread.threadId}:`,
						error
					);
					continue;
				}

				await ctx.db.delete(supportThread._id);
				continue;
			}

			// Update agent:threads userId via component API
			await supportAgent.updateThreadMetadata(ctx, {
				threadId: supportThread.threadId,
				patch: { userId: authUserId }
			});

			// Update supportThreads.userId and enrich with user data
			await ctx.db.patch(supportThread._id, {
				userId: authUserId,
				userName: authUserName,
				userEmail: authUserEmail,
				// Keep existing notification email if set, otherwise use account email
				notificationEmail: supportThread.notificationEmail || authUserEmail,
				updatedAt: Date.now()
			});
		}

		return {
			migratedCount: supportThreads.filter((supportThread) => !supportThread.isWarm).length
		};
	}
});
