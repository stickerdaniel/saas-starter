import { mutation } from './_generated/server';
import { v } from 'convex/values';

// Generate an upload URL for file uploads
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		return await ctx.storage.generateUploadUrl();
	}
});

// Get a file URL from storage ID
export const getImageUrl = mutation({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		return await ctx.storage.getUrl(args.storageId);
	}
});
