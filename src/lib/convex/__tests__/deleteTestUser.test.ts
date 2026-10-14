import { afterEach, describe, expect, it, vi } from 'vitest';

const { incrementCounter } = vi.hoisted(() => ({ incrementCounter: vi.fn() }));
vi.mock('../support/agent', () => ({ supportAgent: {} }));
vi.mock('../admin/counters', () => ({ incrementCounter, recalculateCounters: vi.fn() }));
vi.mock('convex/server', async (importOriginal) => ({
	...(await importOriginal<object>()),
	createFunctionHandle: async () => 'auth-on-delete'
}));
import { createTestAdminUser, deleteTestUser } from '../tests';

type Doc = { _id: string; model: string; userId?: string; email?: string; role?: string };
type DeleteArgs = {
	input: { model: string; where: Array<{ field: string; value: string }> };
	paginationOpts?: unknown;
	onDeleteHandle?: string;
};

/**
 * The Better Auth component's delete endpoints, as `create-api.js` in
 * @convex-dev/better-auth 0.12.5 implements them: the app's delete trigger runs
 * only when the caller passes `onDeleteHandle`, before each `deleteMany` row and
 * after the `deleteOne` row.
 */
function authComponent(docs: Doc[]) {
	const triggered: string[] = [];
	const matches = ({ input }: DeleteArgs) =>
		docs.filter(
			(doc) =>
				doc.model === input.model &&
				input.where.every(({ field, value }) => doc[field as keyof Doc] === value)
		);
	const runTrigger = async (args: DeleteArgs, doc: Doc) => {
		if (args.onDeleteHandle) triggered.push(doc.model);
	};
	const remove = (doc: Doc) => docs.splice(docs.indexOf(doc), 1);
	const ctx = {
		runQuery: async (_ref: unknown, { where }: { where: Array<{ value: string }> }) => {
			const user = docs.find((doc) => doc.model === 'user' && doc.email === where[0].value);
			return user ? { ...user } : null;
		},
		runMutation: async (_ref: unknown, args: DeleteArgs & { input: { update?: object } }) => {
			if (args.input.update) {
				Object.assign(matches(args)[0], args.input.update);
				return null;
			}
			const found = matches(args);
			if (args.paginationOpts) {
				for (const doc of found) {
					await runTrigger(args, doc);
					remove(doc);
				}
				return { count: found.length, isDone: true, continueCursor: '' };
			}
			if (found[0]) {
				remove(found[0]);
				await runTrigger(args, found[0]);
			}
			return null;
		},
		db: {
			query: () => ({ withIndex: () => ({ first: async () => ({ _id: 'pref' }) }) })
		}
	};
	return { ctx, docs, triggered };
}

const run = (fn: unknown, ctx: unknown, email: string) =>
	(fn as { _handler: (ctx: unknown, args: unknown) => Promise<{ success: boolean }> })._handler(
		ctx,
		{ email, secret: 'test-secret' }
	);

afterEach(() => {
	vi.unstubAllEnvs();
	incrementCounter.mockClear();
});

describe('test user fixtures', () => {
	it('runs the auth delete triggers for the user and each of its sessions', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		const email = 'owner@e2e.example.com';
		const { ctx, docs, triggered } = authComponent([
			{ _id: 'u', model: 'user', email },
			{ _id: 's1', model: 'session', userId: 'u' },
			{ _id: 's2', model: 'session', userId: 'u' },
			{ _id: 'a', model: 'account', userId: 'u' }
		]);

		expect((await run(deleteTestUser, ctx, email)).success).toBe(true);
		expect(docs).toEqual([]);
		expect(triggered.sort()).toEqual(['session', 'session', 'user']);
	});

	it('counts an admin promotion once, so the delete trigger leaves the count balanced', async () => {
		vi.stubEnv('AUTH_E2E_TEST_SECRET', 'test-secret');
		const email = 'admin@e2e.example.com';
		const { ctx } = authComponent([{ _id: 'u', model: 'user', email, role: 'user' }]);

		await run(createTestAdminUser, ctx, email);
		await run(createTestAdminUser, ctx, email);

		expect(incrementCounter.mock.calls.map(([, field, delta]) => [field, delta])).toEqual([
			['adminCount', 1]
		]);
	});
});
