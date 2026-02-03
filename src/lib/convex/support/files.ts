import { action, mutation, internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { components, internal } from '../_generated/api';
import { t } from '../i18n/translations';

/**
 * Allowed file types for upload
 */
const ALLOWED_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'application/pdf'
];

/**
 * Generate a URL for uploading files directly to Convex storage
 *
 * This mutation generates a temporary URL that clients can use to upload
 * files directly to Convex storage with progress tracking support.
 */
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		return await ctx.storage.generateUploadUrl();
	}
});

/**
 * Register uploaded file with agent component
 *
 * Call this after successfully uploading to the URL from generateUploadUrl.
 * This action fetches the uploaded file from storage and registers it with
 * the agent component for use in multimodal messages.
 *
 * @param args.storageId - The Convex storage ID of the uploaded file
 * @param args.filename - Optional original filename for display
 * @param args.mimeType - The MIME type of the uploaded file
 * @returns Object containing fileId, storageId, url, filename, and isImage flag
 * @throws {Error} When file type is not allowed (only PNG, JPEG, WebP, GIF, PDF supported)
 * @throws {Error} When storage URL cannot be retrieved
 */
export const saveUploadedFile = action({
	args: {
		storageId: v.id('_storage'),
		filename: v.optional(v.string()),
		mimeType: v.string(),
		locale: v.optional(v.string()),
		width: v.optional(v.number()),
		height: v.optional(v.number())
	},
	handler: async (
		ctx,
		args
	): Promise<{
		fileId: string;
		storageId: string;
		url: string;
		filename: string | undefined;
		isImage: boolean;
	}> => {
		// Validate file type
		if (!ALLOWED_MIME_TYPES.includes(args.mimeType)) {
			throw new Error(t(args.locale, 'backend.files.type_not_allowed'));
		}

		// Get storage URL
		const url = await ctx.storage.getUrl(args.storageId);

		if (!url) {
			throw new Error('Failed to get storage URL');
		}

		// Fetch blob from storage
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(t(args.locale, 'backend.files.fetch_failed'));
		}
		const blob = await response.blob();

		// Register with agent component
		const { file } = await storeFile(ctx, components.agent, blob, {
			filename: args.filename
		});

		// Store dimensions in fileMetadata table for proper dialog sizing
		// (agent component strips unknown fields from file parts)
		if (args.width && args.height && args.mimeType.startsWith('image/')) {
			await ctx.runMutation(internal.support.files.storeFileMetadata, {
				fileId: file.fileId,
				storageId: file.storageId,
				url: file.url, // Store URL for message matching
				width: args.width,
				height: args.height
			});
		}

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			isImage: args.mimeType.startsWith('image/')
		};
	}
});

/**
 * Store file metadata (dimensions) for proper dialog sizing
 *
 * Called internally after uploading an image. Stores dimensions separately
 * because the agent component's file parts schema doesn't preserve custom fields.
 */
export const storeFileMetadata = internalMutation({
	args: {
		fileId: v.string(),
		storageId: v.string(),
		url: v.string(),
		width: v.number(),
		height: v.number()
	},
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

/**
 * Delete legacy fileMetadata records that don't have URL field
 * (One-time cleanup mutation)
 */
export const cleanupLegacyFileMetadata = internalMutation({
	args: {},
	handler: async (ctx) => {
		const allRecords = await ctx.db.query('fileMetadata').collect();
		let deleted = 0;

		for (const record of allRecords) {
			if (!record.url) {
				await ctx.db.delete(record._id);
				deleted++;
			}
		}

		return { deleted, total: allRecords.length };
	}
});
