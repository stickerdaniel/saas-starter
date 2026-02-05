import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { components, internal } from '../_generated/api';

export const cleanupExpiredFiles = internalMutation({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const result = await ctx.runMutation(components.convexFilesControl.cleanUp.cleanupExpired, {
			limit: args.limit
		});

		if (result.hasMore) {
			await ctx.scheduler.runAfter(0, internal.files.cleanup.cleanupExpiredFiles, {
				limit: args.limit
			});
		}

		return result;
	}
});
