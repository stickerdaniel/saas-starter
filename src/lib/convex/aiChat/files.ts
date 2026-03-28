import { v, ConvexError } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { action, mutation } from '../_generated/server';
import { components, internal } from '../_generated/api';
import { t } from '../i18n/translations';
import { aiChatRateLimiter } from './rateLimit';
import { authComponent } from '../auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'application/pdf'
];

/**
 * Generate a URL for uploading files to Convex storage
 *
 * Rate limited per authenticated user.
 */
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new ConvexError('Authentication required');
		}

		const rateLimitStatus = await aiChatRateLimiter.limit(ctx, 'aiChatFileUpload', {
			key: user._id
		});
		if (!rateLimitStatus.ok) {
			throw new ConvexError('Too many file uploads. Please try again later.');
		}

		return await ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
			provider: 'convex'
		});
	}
});

/**
 * Register uploaded file with agent component
 *
 * Validates file type/size, creates download grant, registers with agent.
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
		const accessKey = args.accessKey?.trim() || 'ai-chat';
		await ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
			uploadToken: args.uploadToken,
			storageId: args.storageId,
			accessKeys: [accessKey],
			expiresAt: null
		});

		let file: { fileId: string; storageId: string; url: string; filename?: string };
		let verifiedMimeType: string;
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

			const response = await fetch(downloadResult.downloadUrl);
			if (!response.ok) {
				throw new ConvexError(t(args.locale, 'backend.files.fetch_failed'));
			}
			const blob = await response.blob();

			if (blob.size > MAX_FILE_SIZE) {
				const maxMB = Math.round(MAX_FILE_SIZE / 1024 / 1024);
				throw new ConvexError(
					t(args.locale, 'backend.files.file_too_large', {
						size: `${(blob.size / 1024 / 1024).toFixed(1)}MB`,
						max: `${maxMB}MB`
					})
				);
			}

			if (!ALLOWED_MIME_TYPES.includes(blob.type)) {
				throw new ConvexError(t(args.locale, 'backend.files.type_not_allowed'));
			}
			verifiedMimeType = blob.type;

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

		// Store image dimensions in fileMetadata table
		if (args.width && args.height && verifiedMimeType.startsWith('image/')) {
			await ctx.runMutation(internal.support.files.storeFileMetadata, {
				fileId: file.fileId,
				storageId: file.storageId,
				url: file.url,
				width: args.width,
				height: args.height
			});
		}

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			isImage: verifiedMimeType.startsWith('image/')
		};
	}
});
