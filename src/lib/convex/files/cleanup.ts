import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { components } from '../_generated/api';

export const cleanupExpiredFiles = internalMutation({
	args: { limit: v.optional(v.number()) },
	returns: v.object({ deletedCount: v.number(), hasMore: v.boolean() }),
	handler: async (ctx, args) => {
		// The component schedules its own continuation when the batch has more work.
		return await ctx.runMutation(components.convexFilesControl.cleanUp.cleanupExpired, {
			limit: args.limit
		});
	}
});
