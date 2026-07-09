import { v, ConvexError } from 'convex/values';
import { PROFILE_IMAGE_ALLOWED_TYPES, PROFILE_IMAGE_MAX_SIZE } from './constants';
import { authedMutation } from './functions';
import { components } from './_generated/api';
import { appRateLimiter } from './rateLimit';
import { createRateLimitError } from './support/types';
import { vGenerateUploadUrlResult } from './files/validators';

/**
 * Generate an upload URL for file uploads
 *
 * Creates a temporary URL + upload token for uploading files directly to
 * files-control storage. Requires authentication.
 *
 * @returns Temporary upload URL + token
 * @throws {Error} When user is not authenticated
 */
export const generateUploadUrl = authedMutation({
	args: {},
	returns: vGenerateUploadUrlResult,
	handler: async (ctx) => {
		const status = await appRateLimiter.limit(ctx, 'profileImageUpload', { key: ctx.user._id });
		if (!status.ok) {
			throw createRateLimitError(
				status.retryAfter,
				'Too many upload requests. Please try again later.'
			);
		}
		return await ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
			provider: 'convex'
		});
	}
});

/**
 * Save and validate a profile image upload
 *
 * The file lives in the files-control component's isolated storage namespace,
 * so all reads and deletes go through the component's API — app-side
 * `ctx.db.system` / `ctx.storage` cannot see it. `finalizeUpload` registers
 * the file and returns its storage metadata, which this mutation validates
 * against the profile image requirements (allowed MIME types and size limit),
 * deleting rejected files via the component.
 *
 * Returns a permanent shareable download-grant URL served by the
 * `/files/inline` HTTP route (registered in `http.ts`), which 302-redirects
 * to the storage URL so avatars render inline and browser-cacheable — the
 * component's own `/files/download` route forces `no-store` + `attachment`
 * and proxy-streams the body, which made every avatar render slow. The URL is
 * provider-agnostic: transferring the file to another storage provider
 * rewrites the grant's storageId, so stored avatar URLs keep working.
 *
 * @param args.storageId - The storage ID of the uploaded file
 * @param args.uploadToken - Upload token from files-control
 * @returns Public URL of the validated image
 * @throws {Error} When user is not authenticated
 * @throws {Error} When the upload token is invalid or the file is missing
 * @throws {Error} When file type is not allowed (invalid MIME type)
 * @throws {Error} When file exceeds maximum size limit
 */
export const updateProfileImage = authedMutation({
	args: { storageId: v.string(), uploadToken: v.string() },
	returns: v.string(),
	handler: async (ctx, args) => {
		// Auth is enforced by the authedMutation wrapper before the handler runs.
		// On the auth-failure path the transaction aborts before any storage write,
		// so no manual cleanup is needed: the blob stays orphaned like any abandoned
		// upload, which the files-control cleanup cron reclaims.
		const status = await appRateLimiter.limit(ctx, 'profileImageUpdate', { key: ctx.user._id });
		if (!status.ok) {
			throw createRateLimitError(
				status.retryAfter,
				'Too many upload requests. Please try again later.'
			);
		}

		// Register first: finalizeUpload reads the file's system metadata inside
		// the component (the only place it is visible) and returns it for
		// validation. Rejected files are deleted through the component below.
		const { metadata } = await ctx.runMutation(
			components.convexFilesControl.upload.finalizeUpload,
			{
				uploadToken: args.uploadToken,
				storageId: args.storageId,
				accessKeys: [ctx.user._id],
				expiresAt: null
			}
		);

		// Validate MIME type
		if (!metadata?.contentType || !PROFILE_IMAGE_ALLOWED_TYPES.includes(metadata.contentType)) {
			await ctx.runMutation(components.convexFilesControl.cleanUp.deleteFile, {
				storageId: args.storageId
			});
			throw new ConvexError(
				`Invalid file type. Allowed types: ${PROFILE_IMAGE_ALLOWED_TYPES.join(', ')}`
			);
		}

		// Validate file size
		if (metadata.size > PROFILE_IMAGE_MAX_SIZE) {
			await ctx.runMutation(components.convexFilesControl.cleanUp.deleteFile, {
				storageId: args.storageId
			});
			throw new ConvexError(
				`File too large. Maximum size: ${PROFILE_IMAGE_MAX_SIZE / 1024 / 1024}MB`
			);
		}

		// Avatars are public (<img src>), so issue an unlimited shareable grant:
		// no access key needed, never expires, never exhausts.
		const grant = await ctx.runMutation(
			components.convexFilesControl.download.createDownloadGrant,
			{
				storageId: args.storageId,
				maxUses: null,
				expiresAt: null,
				shareableLink: true
			}
		);

		// CONVEX_SITE_URL is a Convex built-in (the deployment's .convex.site URL).
		const siteUrl = process.env.CONVEX_SITE_URL;
		if (!siteUrl) {
			throw new ConvexError('File storage is not configured.');
		}

		return `${siteUrl}/files/inline?token=${grant.downloadToken}`;
	}
});
