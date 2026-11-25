import type { QueryCtx } from '../../convex/_generated/server';
import { FILE_ERROR_CODES, createFileError } from './errors';

/**
 * Shared file metadata (image dimensions) used by both aiChat and support.
 *
 * Dimensions live in their own table because the agent component strips unknown
 * fields from file parts; they are matched back to messages by URL.
 */

/**
 * Look up image dimensions for a batch of file URLs.
 *
 * Shared by `aiChat.messages.getFileMetadataBatch` and
 * `support.messages.getFileMetadataBatch`; each wrapper applies that surface's
 * access policy before exposing the lookup to the frontend.
 */
export async function getFileMetadataByUrls(
	ctx: QueryCtx,
	urls: string[]
): Promise<Record<string, { width?: number; height?: number }>> {
	const uniqueUrls = [...new Set(urls)];
	if (uniqueUrls.length > 100) {
		throw createFileError(FILE_ERROR_CODES.metadataLimit, { maxUrls: 100 });
	}

	const results: Record<string, { width?: number; height?: number }> = {};

	await Promise.all(
		uniqueUrls.map(async (url) => {
			const meta = await ctx.db
				.query('fileMetadata')
				.withIndex('by_url', (q) => q.eq('url', url))
				.first();

			if (meta && (meta.width || meta.height)) {
				results[url] = { width: meta.width, height: meta.height };
			}
		})
	);

	return results;
}
