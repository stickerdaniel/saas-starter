import { v } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { action, internalMutation, mutation } from '../_generated/server';
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
 * Generate a URL and token for uploading files directly to Convex storage
 *
 * This mutation generates a temporary URL + upload token that clients can use to
 * upload files directly to Convex storage with progress tracking support.
 */
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		return await ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
			provider: 'convex'
		});
	}
});

/**
 * Register uploaded file with agent component
 *
 * Call this after successfully uploading to the URL from generateUploadUrl.
 * This action finalizes the upload with files-control, creates a download grant
 * to fetch the file, then registers it with the agent component.
 *
 * @param args.storageId - The Convex storage ID of the uploaded file
 * @param args.uploadToken - Upload token from files-control generateUploadUrl
 * @param args.filename - Optional original filename for display
 * @param args.mimeType - The MIME type of the uploaded file
 * @param args.locale - Optional locale for translated error messages
 * @param args.accessKey - Optional access key for file control (defaults to 'support')
 * @param args.width - Optional image width for metadata storage
 * @param args.height - Optional image height for metadata storage
 * @returns Object containing fileId, storageId, url, filename, and isImage flag
 * @throws {Error} When file type is not allowed (only PNG, JPEG, WebP, GIF, PDF supported)
 * @throws {Error} When download grant cannot be created or consumed
 * @throws {Error} When file fetch fails
 */
export const saveUploadedFile = action({
	args: {
		storageId: v.id('_storage'),
		uploadToken: v.string(),
		filename: v.optional(v.string()),
		mimeType: v.string(),
		locale: v.optional(v.string()),
		accessKey: v.optional(v.string()),
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

		// Finalize upload with files-control before registering with agent
		const accessKey = args.accessKey?.trim() || 'support';
		await ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
			uploadToken: args.uploadToken,
			storageId: args.storageId,
			accessKeys: [accessKey],
			expiresAt: null
		});

		// All operations after finalizeUpload must clean up on failure
		let file: { fileId: string; storageId: string; url: string; filename?: string };
		try {
			const downloadGrant = await ctx.runMutation(
				components.convexFilesControl.download.createDownloadGrant,
				{
					storageId: args.storageId,
					maxUses: 1,
					expiresAt: Date.now() + 5 * 60 * 1000,
					shareableLink: false
				}
			);

			const downloadResult = await ctx.runMutation(
				components.convexFilesControl.download.consumeDownloadGrantForUrl,
				{
					downloadToken: downloadGrant.downloadToken,
					accessKey
				}
			);

			if (downloadResult.status !== 'ok' || !downloadResult.downloadUrl) {
				throw new Error(`Failed to get download URL: ${downloadResult.status}`);
			}

			// Fetch blob from component storage
			const response = await fetch(downloadResult.downloadUrl);
			if (!response.ok) {
				throw new Error(t(args.locale, 'backend.files.fetch_failed'));
			}
			const blob = await response.blob();

			// Register with agent component
			const result = await storeFile(ctx, components.agent, blob, {
				filename: args.filename
			});
			file = result.file;
		} catch (error) {
			await ctx.runMutation(components.convexFilesControl.cleanUp.deleteFile, {
				storageId: args.storageId
			});
			throw error;
		}

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
