import { internalMutation, mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';
import { isAnonymousUser } from '../utils/anonymousUser';
import { supportAgent } from './agent';
import { buildSupportSearchText } from './denormalization';
import { SUPPORT_ERROR_CODES, createSupportError } from './errors';
import { SUPPORT_THREAD_BATCH_SIZE } from './threadMaintenance';

/**
 * Migrate anonymous support tickets to an authenticated user account.
 *
 * Called from the client when a user logs in or signs up while having
 * anonymous support tickets stored in localStorage.
 *
 * This mutation:
 * 1. Verifies the caller is authenticated
 * 2. Validates the anonymous user ID format
 * 3. Finds the first page of supportThreads belonging to the anonymous user
 * 4. Updates both agent:threads and supportThreads with the authenticated userId
 * 5. Enriches threads with user profile data (name, email)
 * 6. Schedules the next page when more threads remain
 *
 * @security Only authenticated users can call this mutation.
 *           The anonymous ID must have valid anon_ prefix.
 *           Each page migrates atomically (via Convex mutation transactions). Up to
 *           SUPPORT_THREAD_BATCH_SIZE threads move in this call; beyond that the rest
 *           move in scheduled pages, and migratedCount counts only this call's page.
 */
export const migrateAnonymousTickets = mutation({
	args: { anonymousUserId: v.string() },
	returns: v.object({ migratedCount: v.number() }),
	handler: async (ctx, args) => {
		// 1. Verify caller is authenticated.
		// getAuthUser throws ConvexError('Unauthenticated') when there is no user
		const authUser = await authComponent.getAuthUser(ctx);

		// 2. Validate anonymous ID format
		if (!isAnonymousUser(args.anonymousUserId)) {
			throw createSupportError(SUPPORT_ERROR_CODES.anonymousUserInvalid);
		}

		const migratedCount = await migrateThreadPage(ctx, {
			anonymousUserId: args.anonymousUserId,
			authUser,
			cursor: null
		});
		return { migratedCount };
	}
});

/**
 * Migrate the pages after the first. Scheduled only by migrateThreadPage, and
 * enriches threads with the account's current profile, which may have changed
 * since the first page.
 */
export const continueAnonymousTicketMigration = internalMutation({
	args: { anonymousUserId: v.string(), authUserId: v.string(), cursor: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAnyUserById(ctx, args.authUserId);
		if (!authUser) {
			console.log(`[migrateAnonymousTickets] User ${args.authUserId} no longer exists, stopping`);
			return null;
		}

		await migrateThreadPage(ctx, {
			anonymousUserId: args.anonymousUserId,
			authUser,
			cursor: args.cursor
		});
		return null;
	}
});

/** Migrate one page of threads; returns how many non-warm threads it moved. */
async function migrateThreadPage(
	ctx: MutationCtx,
	args: {
		anonymousUserId: string;
		authUser: { _id: string; name: string; email: string };
		cursor: string | null;
	}
): Promise<number> {
	const {
		page: supportThreads,
		isDone,
		continueCursor
	} = await ctx.db
		.query('supportThreads')
		.withIndex('by_user_warm', (q) => q.eq('userId', args.anonymousUserId))
		.paginate({ numItems: SUPPORT_THREAD_BATCH_SIZE, cursor: args.cursor });

	// Extract auth data for use in loop
	const { _id: authUserId, name: authUserName, email: authUserEmail } = args.authUser;

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

			await ctx.db.delete('supportThreads', supportThread._id);
			continue;
		}

		// Update agent:threads userId via component API
		await supportAgent.updateThreadMetadata(ctx, {
			threadId: supportThread.threadId,
			patch: { userId: authUserId }
		});

		// Update supportThreads.userId and enrich with user data.
		// Rebuild searchText so the migrated thread is searchable by the new identity.
		await ctx.db.patch('supportThreads', supportThread._id, {
			userId: authUserId,
			userName: authUserName,
			userEmail: authUserEmail,
			searchText: buildSupportSearchText({
				title: supportThread.title,
				summary: supportThread.summary,
				lastMessage: supportThread.lastMessage,
				userName: authUserName,
				userEmail: authUserEmail
			}),
			// Keep existing notification email if set, otherwise use account email
			notificationEmail: supportThread.notificationEmail || authUserEmail,
			updatedAt: Date.now()
		});
	}

	// 6. The cursor sits after this page, so threads it left behind (a warm
	// thread whose deletion failed) are not read again.
	if (!isDone) {
		await ctx.scheduler.runAfter(0, internal.support.migration.continueAnonymousTicketMigration, {
			anonymousUserId: args.anonymousUserId,
			authUserId,
			cursor: continueCursor
		});
	}

	return supportThreads.filter((supportThread) => !supportThread.isWarm).length;
}
