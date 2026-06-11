import { v } from 'convex/values';

/**
 * Return validator for mutations that proxy
 * `components.convexFilesControl.upload.generateUploadUrl`.
 *
 * Mirrors the files-control component's return shape. `uploadToken` is a
 * component-owned `pendingUploads` ID, which crosses the component boundary
 * as a plain string.
 */
export const vGenerateUploadUrlResult = v.object({
	uploadUrl: v.string(),
	uploadToken: v.string(),
	uploadTokenExpiresAt: v.number(),
	storageProvider: v.union(v.literal('convex'), v.literal('r2')),
	storageId: v.union(v.string(), v.null())
});
