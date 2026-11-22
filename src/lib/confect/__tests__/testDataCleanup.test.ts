import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../support/agent', () => ({ supportAgent: {} }));
vi.mock('../admin/counters', () => ({ recalculateCounters: vi.fn() }));
import { cleanupTestData, deleteAuditLogRows } from '../tests';

type Row = { _id: string; email: string };
function store() {
	const rows = new Map<string, Row>([
		['a', { _id: 'a', email: 'owner-a@e2e.example.com' }],
		['b', { _id: 'b', email: 'owner-b@e2e.example.com' }],
		['real', { _id: 'real', email: 'admin@example.com' }]
	]);
	const context = {
		db: {
			query: () => ({
				collect: async () => [...rows.values()],
				withIndex: (
					_index: string,
					select: (q: { eq: (field: string, email: string) => string }) => string
				) => ({
					unique: async () =>
						[...rows.values()].find(
							(row) => row.email === select({ eq: (_field, email) => email })
						) ?? null
				})
			}),
			delete: async (_table: string, id: string) => {
				rows.delete(id);
			}
		}
	};
	return { rows, context };
}
const invoke = (ctx: unknown, args: { secret: string; emails?: string[] }) =>
	(
		cleanupTestData as unknown as {
			_handler: (ctx: unknown, args: unknown) => Promise<{ deletedCount: number }>;
		}
	)._handler(ctx, args);
afterEach(() => vi.unstubAllEnvs());
describe('owned test recipient cleanup', () => {
	it('deletes only the supplied owner and is safe to repeat', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		const { rows, context } = store();
		expect(
			(await invoke(context, { secret: 'test-secret', emails: ['owner-a@e2e.example.com'] }))
				.deletedCount
		).toBe(1);
		expect([...rows.keys()]).toEqual(['b', 'real']);
		expect(
			(await invoke(context, { secret: 'test-secret', emails: ['owner-a@e2e.example.com'] }))
				.deletedCount
		).toBe(0);
	});
	it('missing ownership deletes nothing and rejects ordinary addresses before writes', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		const { rows, context } = store();
		expect((await invoke(context, { secret: 'test-secret' })).deletedCount).toBe(0);
		await expect(
			invoke(context, {
				secret: 'test-secret',
				emails: ['owner-a@e2e.example.com', 'admin@example.com']
			})
		).rejects.toThrow('exact E2E');
		expect(rows.size).toBe(3);
		await expect(
			invoke(context, { secret: 'wrong', emails: ['owner-a@e2e.example.com'] })
		).rejects.toThrow('Unauthorized');
	});
});

describe('audit fixture cleanup', () => {
	it('deletes the supplied rows and keeps other rows of the same admin', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		const rows = new Map(
			['seeded-1', 'seeded-2', 'real'].map((id) => [id, { _id: id, adminUserId: 'admin_1' }])
		);
		const context = {
			db: {
				get: async (_table: string, id: string) => rows.get(id) ?? null,
				query: () => ({
					withIndex: (
						_index: string,
						select: (q: { eq: (field: string, value: string) => string }) => string
					) => ({
						take: async () => {
							const adminUserId = select({ eq: (_field, value) => value });
							return [...rows.values()].filter((row) => row.adminUserId === adminUserId);
						}
					})
				}),
				delete: async (_table: string, id: string) => {
					rows.delete(id);
				}
			}
		};
		await (
			deleteAuditLogRows as unknown as {
				_handler: (ctx: unknown, args: { secret: string; ids: string[] }) => Promise<null>;
			}
		)._handler(context, { secret: 'test-secret', ids: ['seeded-1', 'seeded-2'] });
		expect([...rows.keys()]).toEqual(['real']);
	});
});
