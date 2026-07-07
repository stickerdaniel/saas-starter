import { v, ConvexError } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { action, internalMutation } from '../_generated/server';
import { components, internal } from '../_generated/api';
import { t } from '../i18n/translations';
import { aiChatRateLimiter } from './rateLimit';
import { authComponent } from '../auth';
import { authedMutation } from '../functions';
import { fetchAttachmentText } from '../files/attachmentText';
import { vGenerateUploadUrlResult } from '../files/validators';
import { validateUploadBlob } from '../files/upload';

/**
 * Generate a URL for uploading files to Convex storage
 *
 * Rate limited per authenticated user.
 */
export const generateUploadUrl = authedMutation({
	args: {},
	returns: vGenerateUploadUrlResult,
	handler: async (ctx) => {
		const rateLimitStatus = await aiChatRateLimiter.limit(ctx, 'aiChatFileUpload', {
			key: ctx.user._id
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
 * Actions cannot use the custom authedMutation wrapper directly. This internal
 * mutation gives aiChat actions the same authenticated boundary before they
 * touch storage.
 */
export const requireFileAccess = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		await authComponent.getAuthUser(ctx);
		return null;
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
	returns: v.object({
		fileId: v.string(),
		storageId: v.string(),
		url: v.string(),
		filename: v.optional(v.string()),
		isImage: v.boolean()
	}),
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
		await ctx.runMutation(internal.aiChat.files.requireFileAccess, {});

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

			// Validate size and MIME type against the actual blob (not the
			// client-supplied args.mimeType, which is untrusted).
			verifiedMimeType = validateUploadBlob(blob, args.locale);

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
			await ctx.runMutation(internal.files.metadata.storeFileMetadata, {
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

/**
 * Gate a preview read: require auth and rate-limit. Runs in a mutation ctx so
 * it can resolve the authenticated user and write to the rate limiter; the
 * action below calls it via runMutation.
 */
export const checkPreviewAccess = internalMutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		// getAuthUser throws ConvexError('Unauthenticated') when there is no user
		const user = await authComponent.getAuthUser(ctx);
		const rateLimitStatus = await aiChatRateLimiter.limit(ctx, 'aiChatFilePreview', {
			key: user._id
		});
		if (!rateLimitStatus.ok) {
			throw new ConvexError('Too many preview requests. Please try again later.');
		}
		return null;
	}
});

/**
 * Read a text attachment's content for the in-app preview dialog.
 *
 * Used by the shared preview component when an attachment has no local blob
 * (e.g. a message reloaded from history). Server-side fetch sidesteps the lack
 * of CORS headers on Convex storage URLs; see fetchAttachmentText for the SSRF
 * guard and size cap.
 */
export const getAttachmentText = action({
	args: { url: v.string(), locale: v.optional(v.string()) },
	returns: v.object({ text: v.string(), truncated: v.boolean() }),
	handler: async (ctx, args): Promise<{ text: string; truncated: boolean }> => {
		await ctx.runMutation(internal.aiChat.files.checkPreviewAccess, {});
		return await fetchAttachmentText(args.url, args.locale);
	}
});
