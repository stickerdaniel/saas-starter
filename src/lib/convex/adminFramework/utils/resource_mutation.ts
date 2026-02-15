import type { MutationCtx } from '../../_generated/server';

export async function softDeleteRecord(ctx: MutationCtx, id: string) {
	await ctx.db.patch(id as any, { deletedAt: Date.now(), updatedAt: Date.now() });
}

export async function restoreRecord(ctx: MutationCtx, id: string) {
	await ctx.db.patch(id as any, { deletedAt: undefined, updatedAt: Date.now() });
}

export function stripSystemFields<T extends Record<string, unknown>>(record: T) {
	const { _id, _creationTime, createdAt, updatedAt, deletedAt, ...rest } = record;
	void _id;
	void _creationTime;
	void createdAt;
	void updatedAt;
	void deletedAt;
	return rest;
}

export function withTimestamps<T extends Record<string, unknown>>(record: T) {
	const now = Date.now();
	return {
		...record,
		createdAt: now,
		updatedAt: now
	};
}
