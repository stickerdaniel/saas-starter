import { describe, expect, it, vi } from 'vitest';

vi.mock('../../auth', () => ({
	authComponent: { getAuthUser: vi.fn(async () => ({ _id: 'admin_1', role: 'admin' })) }
}));

import schema from '../../schema';
import {
	auditLogMetadataValidator,
	listAuditLogs,
	resolveAuditLogLastPage,
	type AuditLogItem
} from './queries';

/**
 * Regression guard: the adminAuditLogs.metadata union is declared twice — once
 * in schema.ts (the table definition, what the writer stores) and once as
 * auditLogMetadataValidator in queries.ts (what the reader returns and the
 * frontend renders). A variant added to one but not the other would let a
 * writer persist a shape the reader can't type. This test compares the
 * structural JSON of both, order-independent, so they can never silently drift.
 */
function normalizeUnion(validator: { isOptional: string }): {
	optional: boolean;
	members: string[];
} {
	// `.json` is a runtime getter on every validator but is intentionally absent
	// from the public TS type, so read it through a narrow cast.
	const json = (validator as unknown as { json: { type: string; value?: unknown[] } }).json;
	const members =
		json.type === 'union' && Array.isArray(json.value)
			? json.value.map((member) => JSON.stringify(member)).sort()
			: [JSON.stringify(json)];
	return { optional: validator.isOptional === 'optional', members };
}

describe('adminAuditLogs.metadata union', () => {
	it('stays structurally in sync between schema.ts and queries.ts', () => {
		const schemaMetadata = schema.tables.adminAuditLogs.validator.fields.metadata;
		expect(normalizeUnion(schemaMetadata)).toEqual(normalizeUnion(auditLogMetadataValidator));
	});
});

type Fn<A, R> = { _handler: (ctx: unknown, args: A) => Promise<R> };
type SearchArgs = { cursor?: string; numItems: number; search: string };
const listHandler = (
	listAuditLogs as unknown as Fn<
		SearchArgs,
		{ items: AuditLogItem[]; continueCursor: string | null; isDone: boolean }
	>
)._handler;
const lastPageHandler = (
	resolveAuditLogLastPage as unknown as Fn<SearchArgs, { page: number; cursor: string | null }>
)._handler;

/**
 * Five log rows where alice is the target of r1, r3 and r5 and the admin of
 * r4; bob only appears in r2. A search for "alice" matches four rows.
 */
function searchCtx() {
	const users = [
		{ _id: 'admin', email: 'admin@x.test' },
		{ _id: 'alice', email: 'alice@x.test' },
		{ _id: 'bob', email: 'bob@x.test' }
	];
	const logs = [
		{ _id: 'r1', adminUserId: 'admin', targetUserId: 'alice' },
		{ _id: 'r2', adminUserId: 'admin', targetUserId: 'bob' },
		{ _id: 'r3', adminUserId: 'admin', targetUserId: 'alice' },
		{ _id: 'r4', adminUserId: 'alice', targetUserId: 'bob' },
		{ _id: 'r5', adminUserId: 'admin', targetUserId: 'alice' }
	].map((row, index) => ({ ...row, action: 'revoke_sessions', timestamp: index }));
	const take = vi.fn(async () => logs);
	return {
		db: { query: () => ({ withIndex: () => ({ order: () => ({ take }) }) }) },
		runQuery: async () => ({ page: users, continueCursor: null, isDone: true })
	};
}

describe('listAuditLogs search path', () => {
	it('pages the matching rows by offset cursor', async () => {
		const ctx = searchCtx();
		const first = await listHandler(ctx, { numItems: 3, search: 'alice' });
		expect(first.items.map((row) => row.id)).toEqual(['r1', 'r3', 'r4']);
		expect(first).toMatchObject({ continueCursor: '3', isDone: false });

		const last = await listHandler(ctx, {
			numItems: 3,
			search: 'alice',
			cursor: first.continueCursor!
		});
		expect(last.items.map((row) => row.id)).toEqual(['r5']);
		expect(last).toMatchObject({ continueCursor: null, isDone: true });
	});

	it('resolves the last search page by offset', async () => {
		await expect(lastPageHandler(searchCtx(), { numItems: 3, search: 'alice' })).resolves.toEqual({
			page: 2,
			cursor: '3'
		});
		await expect(lastPageHandler(searchCtx(), { numItems: 4, search: 'alice' })).resolves.toEqual({
			page: 1,
			cursor: null
		});
	});
});
