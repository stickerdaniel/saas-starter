import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { PROFILE_IMAGE_ALLOWED_TYPES, PROFILE_IMAGE_MAX_SIZE } from './constants';

// Generate an upload URL for file uploads (authenticated)
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Unauthorized');
		}
		return await ctx.storage.generateUploadUrl();
	}
});

// Save and validate a profile image upload
export const saveProfileImage = mutation({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
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

		return await ctx.storage.getUrl(args.storageId);
	}
});
