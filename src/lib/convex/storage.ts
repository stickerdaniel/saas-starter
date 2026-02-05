import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { PROFILE_IMAGE_ALLOWED_TYPES, PROFILE_IMAGE_MAX_SIZE } from './constants';
import { authComponent } from './auth';
import { components } from './_generated/api';

/**
 * Generate an upload URL for file uploads
 *
 * Creates a temporary URL + upload token for uploading files directly to Convex storage.
 * Requires authentication.
 *
 * @returns Temporary upload URL + token
 * @throws {Error} When user is not authenticated
 */
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error('Unauthorized');
		}
		return await ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
			provider: 'convex'
		});
	}
});

/**
 * Save and validate a profile image upload
 *
 * Validates that the uploaded file meets profile image requirements
 * (allowed MIME types and size limits). Deletes invalid files from storage.
 *
 * @param args.storageId - The storage ID of the uploaded file
 * @param args.uploadToken - Upload token from files-control
 * @returns Public URL of the validated image
 * @throws {Error} When user is not authenticated
 * @throws {Error} When file is not found in storage
 * @throws {Error} When file type is not allowed (invalid MIME type)
 * @throws {Error} When file exceeds maximum size limit
 */
export const updateProfileImage = mutation({
	args: { storageId: v.id('_storage'), uploadToken: v.string() },
	handler: async (ctx, args) => {
		const user = await authComponent.getAuthUser(ctx);
		if (!user) {
			throw new Error('Unauthorized');
		}

		const metadata = await ctx.db.system.get(args.storageId);
		if (!metadata) {
			throw new Error('File not found');
		}

		// Validate MIME type
		if (!metadata.contentType || !PROFILE_IMAGE_ALLOWED_TYPES.includes(metadata.contentType)) {
			await ctx.storage.delete(args.storageId);
			throw new Error(
				`Invalid file type. Allowed types: ${PROFILE_IMAGE_ALLOWED_TYPES.join(', ')}`
			);
		}

		// Validate file size
		if (metadata.size > PROFILE_IMAGE_MAX_SIZE) {
			await ctx.storage.delete(args.storageId);
			throw new Error(`File too large. Maximum size: ${PROFILE_IMAGE_MAX_SIZE / 1024 / 1024}MB`);
		}

		await ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
			uploadToken: args.uploadToken,
			storageId: args.storageId,
			accessKeys: [user._id],
			expiresAt: null
		});

		return await ctx.storage.getUrl(args.storageId);
	}
});
