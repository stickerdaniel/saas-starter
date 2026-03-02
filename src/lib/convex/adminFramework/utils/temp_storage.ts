import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { internal } from '../../_generated/api';

/** Default TTL for temporary files: 5 minutes. */
const TEMP_FILE_TTL_MS = 5 * 60 * 1000;

/**
 * Store a Blob in Convex storage, schedule its automatic cleanup,
 * and return the public download URL.
 *
 * Use this from any mutation context where you need to generate a
 * temporary file (CSV export, PDF report, etc.) and hand the user
 * a short-lived download link.
 *
 * @param ctx - Mutation context (needs `ctx.storage` and `ctx.scheduler`)
 * @param blob - The file content as a Blob
 * @param ttlMs - Time-to-live in ms before automatic deletion (default 5 min)
 * @returns Object with `storageId` and `url`
 */
export async function storeTempBlob(
	ctx: {
		storage: {
			store: (blob: Blob) => Promise<string>;
			getUrl: (id: string) => Promise<string | null>;
		};
		scheduler: { runAfter: (delayMs: number, fn: any, args: any) => Promise<any> };
	},
	blob: Blob,
	ttlMs: number = TEMP_FILE_TTL_MS
): Promise<{ storageId: string; url: string }> {
	const storageId = await ctx.storage.store(blob);
	const url = await ctx.storage.getUrl(storageId);
	if (!url) {
		throw new Error('Failed to generate download URL for temp file');
	}

	// Schedule automatic cleanup
	await ctx.scheduler.runAfter(ttlMs, internal.adminFramework.utils.temp_storage.deleteTempFile, {
		storageId
	});

	return { storageId, url };
}

/**
 * Internal mutation that deletes a temporary file from storage.
 * Scheduled automatically by `storeTempBlob`.
 */
export const deleteTempFile = internalMutation({
	args: { storageId: v.string() },
	handler: async (ctx, args) => {
		try {
			await ctx.storage.delete(args.storageId as any);
		} catch {
			// File may already have been deleted; ignore
		}
	}
});
