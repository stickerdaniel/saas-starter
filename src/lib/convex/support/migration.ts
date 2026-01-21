import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { authComponent } from '../auth';
import { isAnonymousUser } from '../utils/anonymousUser';
import { components } from '../_generated/api';
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
 * 3. Finds all threads belonging to the anonymous user
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
			throw new Error('Authentication required');
		}

		// 2. Validate anonymous ID format
		if (!isAnonymousUser(args.anonymousUserId)) {
			throw new Error('Invalid anonymous user ID');
		}

		// 3. Find all agent:threads with anonymous userId
		const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
			userId: args.anonymousUserId,
			paginationOpts: { numItems: 100, cursor: null }
		});

		if (threads.page.length === 0) {
			return { migratedCount: 0 };
		}

		// Extract auth data for use in loop
		const { _id: authUserId, name: authUserName, email: authUserEmail } = authUser;

		// 4. Update each thread
		for (const thread of threads.page) {
			// Update agent:threads userId via component API
			await supportAgent.updateThreadMetadata(ctx, {
				threadId: thread._id,
				patch: { userId: authUserId }
			});

			// Update supportThreads.userId and enrich with user data
			const supportThread = await ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', thread._id))
				.first();

			if (supportThread) {
				await ctx.db.patch(supportThread._id, {
					userId: authUserId,
					userName: authUserName,
					userEmail: authUserEmail,
					// Keep existing notification email if set, otherwise use account email
					notificationEmail: supportThread.notificationEmail || authUserEmail,
					updatedAt: Date.now()
				});
			}
		}

		return { migratedCount: threads.page.length };
	}
});
