import { action, mutation } from '../_generated/server';
import { v } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { components } from '../_generated/api';

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
 * @returns fileId, storageId, url, filename, and isImage flag
 */
export const saveUploadedFile = action({
	args: {
		storageId: v.id('_storage'),
		filename: v.optional(v.string()),
		mimeType: v.string()
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
			throw new Error('File type not allowed. Supported: PNG, JPEG, WebP, GIF, PDF');
		}

		// Get storage URL
		const url = await ctx.storage.getUrl(args.storageId);

		if (!url) {
			throw new Error('Failed to get storage URL');
		}

		// Fetch blob from storage
		const response = await fetch(url);
		const blob = await response.blob();

		// Register with agent component
		const { file } = await storeFile(ctx, components.agent, blob, {
			filename: args.filename
		});

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			isImage: args.mimeType.startsWith('image/')
		};
	}
});
