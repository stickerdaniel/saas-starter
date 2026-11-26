import { getFile } from '@convex-dev/agent';
import { components } from '../../convex/_generated/api';
import type { MutationCtx, QueryCtx } from '../../convex/_generated/server';

export const ownerRow = (ctx: QueryCtx, fileId: string, ownerId: string) =>
	ctx.db
		.query('fileOwners')
		.withIndex('by_file_and_owner', (q) => q.eq('fileId', fileId).eq('ownerId', ownerId))
		.first();

export async function ownedFilePart(ctx: MutationCtx, fileId: string, ownerId: string) {
	if ((await ownerRow(ctx, fileId, ownerId)) === null) {
		throw new Error(`File not found in component: ${fileId}`);
	}
	return (await getFile(ctx, components.agent, fileId)).filePart;
}
