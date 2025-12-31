import { internalMutation } from '../_generated/server';
import { components } from '../_generated/api';

/**
 * Backfill search fields for existing supportThreads records.
 *
 * Run with: bunx convex run migrations/backfillSearchFields
 *
 * This populates the denormalized search fields (searchText, title, summary,
 * lastMessage, userName, userEmail) for all existing supportThreads that
 * don't have searchText yet.
 */
export default internalMutation({
	args: {},
	handler: async (ctx) => {
		const supportThreads = await ctx.db.query('supportThreads').collect();

		let updated = 0;
		let skipped = 0;
		let failed = 0;

		for (const supportThread of supportThreads) {
			// Skip if already has searchText
			if (supportThread.searchText) {
				skipped++;
				continue;
			}

			try {
				// Get agent thread metadata
				const agentThread = await ctx.runQuery(components.agent.threads.getThread, {
					threadId: supportThread.threadId
				});

				if (!agentThread) {
					console.log(`[backfill] Skipping deleted thread: ${supportThread.threadId}`);
					skipped++;
					continue;
				}

				// Get last message (truncated to 500 chars for search)
				const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
					threadId: supportThread.threadId,
					order: 'desc',
					statuses: ['success'],
					excludeToolMessages: true,
					paginationOpts: { numItems: 1, cursor: null }
				});
				const lastMessageText = messages.page[0]?.text;
				const lastMessage = lastMessageText?.slice(0, 500);

				// Get user info (skip anonymous users)
				let userName: string | undefined;
				let userEmail: string | undefined;

				if (agentThread.userId && !agentThread.userId.startsWith('anon_')) {
					try {
						const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
							model: 'user',
							where: [{ field: '_id', operator: 'eq', value: agentThread.userId }]
						});
						if (user) {
							userName = user.name;
							userEmail = user.email;
						}
					} catch (error) {
						console.log(`[backfill] Failed to fetch user ${agentThread.userId}:`, error);
					}
				}

				// Build searchText (combine all searchable fields)
				const searchText = [
					agentThread.title,
					agentThread.summary,
					lastMessage,
					userName,
					userEmail
				]
					.filter(Boolean)
					.join(' | ')
					.toLowerCase();

				// Update supportThread with denormalized fields
				await ctx.db.patch(supportThread._id, {
					searchText: searchText || 'untitled',
					title: agentThread.title,
					summary: agentThread.summary,
					lastMessage,
					userName,
					userEmail
				});

				updated++;
				console.log(`[backfill] Updated: ${supportThread.threadId}`);
			} catch (error) {
				failed++;
				console.error(`[backfill] Failed: ${supportThread.threadId}`, error);
			}
		}

		console.log(`[backfill] Complete: ${updated} updated, ${skipped} skipped, ${failed} failed`);
		return { updated, skipped, failed, total: supportThreads.length };
	}
});
