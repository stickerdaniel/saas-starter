import { describe, expect, it } from 'vitest';
import { runPage, start } from './activityMigration';
import { getAiChatSidebarActivityAt } from './visibility';

type Row = {
	_id: string;
	threadId: string;
	lastMessageAt?: number;
	lastMessage?: string;
	isWarm?: boolean;
	sidebarActivityAt?: number;
};
type State = {
	_id: string;
	version: number;
	status: string;
	cursor: string | null;
	processed: number;
	scheduledFnId?: string;
};
type PageArgs = { id: string; cursor: string | null };
const invoke = <R>(fn: unknown, ctx: unknown, args: unknown): Promise<R> =>
	(fn as { _handler: (ctx: unknown, args: unknown) => Promise<R> })._handler(ctx, args);

function fixture(rows: Row[]) {
	let state: State | null = null;
	let generations = 0;
	const jobs: PageArgs[] = [];
	const jobStates = new Map<string, string>();
	const ctx = {
		db: {
			system: {
				get: async (id: string) =>
					jobStates.has(id) ? { state: { kind: jobStates.get(id) } } : null
			},
			query: (table: string) => ({
				first: async () => (table === 'aiChatHistoryMigration' ? state : (rows[0] ?? null)),
				unique: async () => state,
				paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
					const offset = cursor ? Number(cursor) : 0;
					const page = rows.slice(offset, offset + numItems);
					return {
						page,
						continueCursor: String(offset + page.length),
						isDone: offset + page.length >= rows.length
					};
				}
			}),
			get: async (_table: string, id: string) => (state?._id === id ? state : null),
			delete: async () => {
				state = null;
			},
			insert: async (_table: string, value: Omit<State, '_id'>) => {
				state = { _id: `migration-${++generations}`, ...value };
				return state._id;
			},
			patch: async (table: string, id: string, patch: object) => {
				if (table === 'aiChatHistoryMigration') Object.assign(state!, patch);
				else
					Object.assign(
						rows.find((row) => row._id === id)!,
						patch
					);
			}
		},
		scheduler: {
			runAfter: async (_delay: number, _ref: unknown, args: PageArgs) => {
				jobs.push(args);
				jobStates.set(`job-${jobs.length}`, 'pending');
				return `job-${jobs.length}`;
			},
			runAt: async (_delay: number, _ref: unknown, args: PageArgs) => {
				jobs.push(args);
				jobStates.set(`job-${jobs.length}`, 'pending');
				return `job-${jobs.length}`;
			}
		}
	};
	return { ctx, jobs, jobStates, state: () => state };
}

describe('AI sidebar activity', () => {
	it.each([
		[{}, undefined],
		[{ isWarm: true, lastMessageAt: 5 }, undefined],
		[{ lastMessage: 'Legacy preview' }, 0],
		[{ lastMessageAt: 0 }, 0],
		[{ lastMessageAt: 25 }, 25]
	] as const)('preserves visibility and legacy ordering for %j', (row, expected) => {
		expect(getAiChatSidebarActivityAt(row)).toBe(expected);
	});
	it('finishes an empty deployment without scheduling work', async () => {
		const f = fixture([]);
		await expect(invoke(start, f.ctx, {})).resolves.toMatchObject({
			status: 'complete',
			processed: 0
		});
		expect(f.jobs).toEqual([]);
	});
	it('reuses the active run and resumes from its committed checkpoint', async () => {
		const rows = Array.from({ length: 205 }, (_, i) => ({
			_id: `row-${i}`,
			threadId: `thread-${i}`,
			lastMessageAt: i
		}));
		const f = fixture(rows);
		await invoke(start, f.ctx, {});
		await invoke(start, f.ctx, {});
		expect(f.jobs).toHaveLength(1);
		const first = f.jobs[0];
		await invoke(runPage, f.ctx, first);
		expect(f.state()?.processed).toBe(100);
		await invoke(runPage, f.ctx, first);
		expect(f.state()?.processed).toBe(100);
		await invoke(start, f.ctx, {});
		expect(f.jobs).toHaveLength(2);
		for (let i = 1; i < f.jobs.length; i++) await invoke(runPage, f.ctx, f.jobs[i]);
		expect(f.state()).toMatchObject({
			status: 'complete',
			processed: 205,
			scheduledFnId: undefined
		});
		expect(rows.map((row) => (row as Row).sidebarActivityAt)).toEqual(
			Array.from({ length: 205 }, (_, i) => i)
		);
		await invoke(start, f.ctx, {});
		expect(f.jobs).toHaveLength(3);
	});
	it('removes activity from hidden rows and retains visible timestamp zero', async () => {
		const rows: Row[] = [
			{ _id: 'warm', threadId: 'warm', isWarm: true, lastMessageAt: 10, sidebarActivityAt: 10 },
			{ _id: 'legacy', threadId: 'legacy', lastMessage: 'Preview' },
			{ _id: 'file', threadId: 'file', lastMessageAt: 0 },
			{ _id: 'empty', threadId: 'empty', sidebarActivityAt: 12 }
		];
		const f = fixture(rows);
		await invoke(start, f.ctx, {});
		await invoke(runPage, f.ctx, f.jobs[0]);
		expect(rows.map((row) => row.sidebarActivityAt)).toEqual([undefined, 0, 0, undefined]);
	});
	it('restarts after an old writer rollout and fences earlier callbacks', async () => {
		const rows: Row[] = [{ _id: 'legacy', threadId: 'legacy', lastMessageAt: 10 }];
		const f = fixture(rows);
		await invoke(start, f.ctx, {});
		const oldPage = f.jobs[0];
		await invoke(runPage, f.ctx, oldPage);
		rows[0].lastMessageAt = 20;
		await invoke(start, f.ctx, { restart: true });
		await invoke(runPage, f.ctx, oldPage);
		expect(rows[0].sidebarActivityAt).toBe(10);
		expect(f.state()?.processed).toBe(0);
		await invoke(start, f.ctx, { restart: true });
		expect(f.jobs).toHaveLength(2);
		await invoke(runPage, f.ctx, f.jobs[1]);
		expect(rows[0].sidebarActivityAt).toBe(20);
		expect(f.state()?.status).toBe('complete');
	});
	it('resumes a failed page from the last committed checkpoint', async () => {
		const rows = Array.from({ length: 205 }, (_, i) => ({
			_id: `row-${i}`,
			threadId: `thread-${i}`,
			lastMessageAt: i
		}));
		const f = fixture(rows);
		await invoke(start, f.ctx, {});
		await invoke(runPage, f.ctx, f.jobs[0]);
		f.jobStates.set('job-2', 'failed');
		await invoke(start, f.ctx, {});
		await invoke(start, f.ctx, {});
		expect(f.jobs).toHaveLength(3);
		await invoke(runPage, f.ctx, f.jobs[2]);
		expect(f.state()?.processed).toBe(200);
		await invoke(runPage, f.ctx, f.jobs[3]);
		expect(f.state()).toMatchObject({ status: 'complete', processed: 205 });
	});
});
