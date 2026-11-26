import type { FilePart } from 'ai';
import * as Effect from 'effect/Effect';
import { components } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { QueryCtx } from '../../convex/_generated/server';

export const ownerRow = (ctx: QueryCtx, fileId: string, ownerId: string) =>
	ctx.db
		.query('fileOwners')
		.withIndex('by_fileId_and_ownerId', (q) => q.eq('fileId', fileId).eq('ownerId', ownerId))
		.first();

async function filePart(ctx: QueryCtx, fileId: string): Promise<FilePart | undefined> {
	const file = await ctx.runQuery(components.agent.files.get, { fileId });
	if (!file) return undefined;
	const url = await ctx.storage.getUrl(file.storageId as Id<'_storage'>);
	if (!url) return undefined;
	return {
		type: 'file',
		data: new URL(url),
		mediaType: file.mediaType ?? file.mimeType ?? '',
		filename: file.filename
	};
}

async function ownedFileParts(ctx: QueryCtx, ownerId: string, fileIds: readonly string[]) {
	const rows = await Promise.all(
		[...new Set(fileIds)].map((fileId) => ownerRow(ctx, fileId, ownerId))
	);
	if (rows.includes(null)) return undefined;
	const parts: FilePart[] = [];
	for (const fileId of fileIds) {
		const part = await filePart(ctx, fileId);
		if (!part) return undefined;
		parts.push(part);
	}
	return parts;
}

export const requireOwnedFiles = <Refusal>(
	ctx: QueryCtx,
	ownerId: string,
	fileIds: readonly string[],
	refusal: Refusal
) =>
	Effect.promise(() => ownedFileParts(ctx, ownerId, fileIds)).pipe(
		Effect.flatMap((parts) => (parts ? Effect.succeed(parts) : Effect.fail(refusal)))
	);
