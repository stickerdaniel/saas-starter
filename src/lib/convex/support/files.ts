import { v, ConvexError } from 'convex/values';
import { storeFile } from '@convex-dev/agent';
import { action, internalMutation, mutation } from '../_generated/server';
import { components, internal } from '../_generated/api';
import { t } from '../i18n/translations';
import { supportRateLimiter } from './rateLimit';
import { createRateLimitError } from './types';
import { getSupportOwnerIdentity } from './ownership';
import { fetchAttachmentText } from '../files/attachmentText';
import { vGenerateUploadUrlResult } from '../files/validators';
import { validateUploadBlob } from '../files/upload';

/**
 * Generate a URL and token for uploading files directly to Convex storage
 *
 * This mutation generates a temporary URL + upload token that clients can use to
 * upload files directly to Convex storage with progress tracking support.
 *
 * Rate limited per user to prevent storage abuse.
 *
 * @security Anonymous access: support file uploads are available to unauthenticated users
 */
export const generateUploadUrl = mutation({
	args: {
		anonymousUserId: v.optional(v.string())
	},
	returns: vGenerateUploadUrlResult,
	handler: async (ctx, args) => {
		const owner = await getSupportOwnerIdentity(ctx, args.anonymousUserId);

		// Rate limit check - anonymous users share a single global bucket to prevent
		// storage abuse via ID rotation (anonymous IDs are client-generated)
		const isAnon = !owner || owner.isAnonymous;
		const limitName = isAnon ? 'supportFileUploadAnon' : 'supportFileUpload';
		const userKey = isAnon ? 'anonymous-global' : owner.ownerId;

		const rateLimitStatus = await supportRateLimiter.limit(ctx, limitName, { key: userKey });

		if (!rateLimitStatus.ok) {
			throw createRateLimitError(
				rateLimitStatus.retryAfter,
				'Too many file uploads. Please try again later.'
			);
		}

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
 * @throws {Error} When file type is not allowed (PNG, JPEG, WebP, GIF, PDF, Markdown, plain text)
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

			// Fetch blob from component storage
			const response = await fetch(downloadResult.downloadUrl);
			if (!response.ok) {
				throw new ConvexError(t(args.locale, 'backend.files.fetch_failed'));
			}
			const blob = await response.blob();

			// Validate size and MIME type against the actual blob (not the
			// client-supplied args.mimeType, which is untrusted).
			verifiedMimeType = validateUploadBlob(blob, args.locale);

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
		if (args.width && args.height && verifiedMimeType.startsWith('image/')) {
			await ctx.runMutation(internal.files.metadata.storeFileMetadata, {
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
			isImage: verifiedMimeType.startsWith('image/')
		};
	}
});

/**
 * Gate a preview read: resolve owner (auth or anonymous) and rate-limit. Runs
 * in a mutation ctx so it can read auth and write to the rate limiter; the
 * action below calls it via runMutation.
 *
 * @security Anonymous access mirrors the upload flow: support previews are
 * available to unauthenticated users, anonymous callers share a global bucket.
 */
export const checkPreviewAccess = internalMutation({
	args: { anonymousUserId: v.optional(v.string()) },
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await getSupportOwnerIdentity(ctx, args.anonymousUserId);
		const isAnon = !owner || owner.isAnonymous;
		const limitName = isAnon ? 'supportFilePreviewAnon' : 'supportFilePreview';
		const userKey = isAnon ? 'anonymous-global' : owner.ownerId;

		const rateLimitStatus = await supportRateLimiter.limit(ctx, limitName, { key: userKey });
		if (!rateLimitStatus.ok) {
			throw createRateLimitError(
				rateLimitStatus.retryAfter,
				'Too many preview requests. Please try again later.'
			);
		}
		return null;
	}
});

/**
 * Read a text attachment's content for the in-app preview dialog.
 *
 * Used by the shared preview component when an attachment has no local blob
 * (e.g. an admin viewing a user-uploaded file, or a message reloaded from
 * history). Server-side fetch sidesteps the lack of CORS headers on Convex
 * storage URLs; see fetchAttachmentText for the SSRF guard and size cap.
 *
 * @security Anonymous access: available to unauthenticated support users.
 */
export const getAttachmentText = action({
	args: {
		url: v.string(),
		anonymousUserId: v.optional(v.string()),
		locale: v.optional(v.string())
	},
	returns: v.object({ text: v.string(), truncated: v.boolean() }),
	handler: async (ctx, args): Promise<{ text: string; truncated: boolean }> => {
		await ctx.runMutation(internal.support.files.checkPreviewAccess, {
			anonymousUserId: args.anonymousUserId
		});
		return await fetchAttachmentText(args.url, args.locale);
	}
});
