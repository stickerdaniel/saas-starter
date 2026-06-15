import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';

/**
 * Shared file metadata (image dimensions) used by both aiChat and support.
 *
 * Dimensions live in their own table because the agent component strips unknown
 * fields from file parts; they are matched back to messages by URL.
 */

/**
 * Look up image dimensions for a batch of file URLs.
 *
 * Shared by `aiChat.messages.getFileMetadataBatch` and
 * `support.messages.getFileMetadataBatch`, which both expose this over their
 * own public query for the frontend.
 */
export async function getFileMetadataByUrls(
	ctx: QueryCtx,
	urls: string[]
): Promise<Record<string, { width?: number; height?: number }>> {
	const results: Record<string, { width?: number; height?: number }> = {};

	await Promise.all(
		urls.map(async (url) => {
			const meta = await ctx.db
				.query('fileMetadata')
				.withIndex('by_url', (q) => q.eq('url', url))
				.first();

			if (meta && (meta.width || meta.height)) {
				results[url] = { width: meta.width, height: meta.height };
			}
		})
	);

	return results;
}

/**
 * Store file metadata (dimensions) for proper dialog sizing.
 *
 * Called internally after uploading an image from either feature. Stores
 * dimensions separately because the agent component's file parts schema
 * doesn't preserve custom fields.
 */
export const storeFileMetadata = internalMutation({
	args: {
		fileId: v.string(),
		storageId: v.string(),
		url: v.string(),
		width: v.number(),
		height: v.number()
	},
	returns: v.id('fileMetadata'),
	handler: async (ctx, args) => {
		// Check if metadata already exists by URL (avoid duplicates)
		const existing = await ctx.db
			.query('fileMetadata')
			.withIndex('by_url', (q) => q.eq('url', args.url))
			.first();

		if (existing) {
			// Update existing metadata
			await ctx.db.patch(existing._id, {
				width: args.width,
				height: args.height
			});
			return existing._id;
		}

		// Insert new metadata
		return await ctx.db.insert('fileMetadata', {
			fileId: args.fileId,
			storageId: args.storageId,
			url: args.url,
			width: args.width,
			height: args.height,
			createdAt: Date.now()
		});
	}
});
