import type { ActionCtx } from '../_generated/server';
import { components } from '../_generated/api';

// Crash fallback, comfortably beyond the maximum action execution lifetime.
export const UPLOAD_STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export async function releaseUploadStaging(
	ctx: Pick<ActionCtx, 'runMutation'>,
	storageId: string
): Promise<void> {
	try {
		await ctx.runMutation(components.convexFilesControl.cleanUp.deleteFile, { storageId });
	} catch {
		// An accepted upload must not fail because housekeeping failed. Expiry retries cleanup.
		console.error('Upload staging cleanup failed; finite expiry will recover it');
	}
}
