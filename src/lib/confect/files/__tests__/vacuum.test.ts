// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import { mutationGeneric, type GenericDataModel, type GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';

const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);

const skippedByComponent = new Set<string>();

const agentFilesPath = Object.keys(agentModules).find((path) =>
	path.endsWith('/component/files.js')
);
if (agentFilesPath === undefined) throw new Error('agent has no files module');
const loadAgentFiles = agentModules[agentFilesPath];

agentModules[agentFilesPath] = async () => {
	const files = (await loadAgentFiles()) as {
		deleteFiles: {
			_handler: (
				ctx: GenericMutationCtx<GenericDataModel>,
				args: { fileIds: string[]; force?: boolean }
			) => Promise<string[]>;
		};
	};
	return {
		...files,
		deleteFiles: mutationGeneric({
			args: { fileIds: v.array(v.string()), force: v.optional(v.boolean()) },
			returns: v.array(v.string()),
			handler: async (ctx, args) =>
				await files.deleteFiles._handler(ctx, {
					...args,
					fileIds: args.fileIds.filter((fileId) => !skippedByComponent.has(fileId))
				})
		})
	};
};

const DAY_MS = 1000 * 60 * 60 * 24;
const START = Date.UTC(2026, 9, 8, 12);
const PAGE_SIZE = 100;
const PURGE_BUDGET = 2_000;
const PURGE = 'files/owners:purge';

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('agent', agentSchema, agentModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function addAgentFile(t: Harness, hash: string) {
	const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([hash])));
	const { fileId } = await t.mutation(components.agent.files.addFile, {
		storageId,
		hash,
		filename: `${hash}.png`
	});
	return { storageId, fileId };
}

const addOwners = (t: Harness, fileId: string, count: number) =>
	t.run(async (ctx) => {
		for (let i = 0; i < count; i++) {
			await ctx.db.insert('fileOwners', { fileId, ownerId: `owner_${i}` });
		}
	});

const ownerFileIds = (t: Harness) =>
	t.run(async (ctx) => (await ctx.db.query('fileOwners').take(60_000)).map((row) => row.fileId));

const addMetadata = (t: Harness, storageId: string, url: string) =>
	t.run(
		async (ctx) =>
			await ctx.db.insert('fileMetadata', {
				fileId: `file-${url}`,
				storageId,
				url,
				width: 1,
				height: 1,
				createdAt: Date.now()
			})
	);

const metadataStorageIds = (t: Harness) =>
	t.run(async (ctx) => (await ctx.db.query('fileMetadata').take(10)).map((row) => row.storageId));

const storedBlob = (t: Harness, storageId: string) =>
	t.run(async (ctx) => await ctx.db.system.get(storageId as never));

const scheduled = (t: Harness) =>
	t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').take(10));

const pendingPurges = (t: Harness) =>
	t.run(async (ctx) =>
		(await ctx.db.system.query('_scheduled_functions').take(100)).filter(
			(job) => job.name === PURGE && job.state.kind === 'pending'
		)
	);

const vacuum = (t: Harness) => t.mutation(internal.files.vacuum.deleteUnusedFiles, {});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	skippedByComponent.clear();
});

describe('files vacuum', () => {
	it('cascade-deletes fileMetadata rows for vacuumed files', async () => {
		const t = harness();
		const stale = await addAgentFile(t, 'stale');
		await addMetadata(t, stale.storageId, 'https://files.test/stale-1');
		await addMetadata(t, stale.storageId, 'https://files.test/stale-2');
		await addMetadata(t, 'storage_other', 'https://files.test/other');
		vi.setSystemTime(START + 2 * DAY_MS);

		await vacuum(t);

		expect(await storedBlob(t, stale.storageId)).toBeNull();
		expect(await metadataStorageIds(t)).toEqual(['storage_other']);
		const remaining = await t.query(components.agent.files.getFilesToDelete, {
			paginationOpts: { cursor: null, numItems: 10 }
		});
		expect(remaining.page).toEqual([]);
		expect(await scheduled(t)).toEqual([
			expect.objectContaining({ name: PURGE, args: [{ fileIds: [stale.fileId] }] })
		]);
	});

	it('keeps fileMetadata for recently touched files', async () => {
		const t = harness();
		const fresh = await addAgentFile(t, 'fresh');
		await addMetadata(t, fresh.storageId, 'https://files.test/fresh');

		await vacuum(t);

		expect(await storedBlob(t, fresh.storageId)).not.toBeNull();
		expect(await metadataStorageIds(t)).toEqual([fresh.storageId]);
		expect(await scheduled(t)).toEqual([]);
	});

	it('keeps the blob, metadata and owners of a file the component does not delete', async () => {
		const t = harness();
		const kept = await addAgentFile(t, 'kept');
		const gone = await addAgentFile(t, 'gone');
		for (const file of [kept, gone]) {
			await addMetadata(t, file.storageId, `https://files.test/${file.fileId}`);
			await addOwners(t, file.fileId, 2);
		}
		skippedByComponent.add(kept.fileId);
		vi.setSystemTime(START + 2 * DAY_MS);

		await vacuum(t);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(await storedBlob(t, kept.storageId)).not.toBeNull();
		expect(await storedBlob(t, gone.storageId)).toBeNull();
		expect(await metadataStorageIds(t)).toEqual([kept.storageId]);
		expect(await ownerFileIds(t)).toEqual([kept.fileId, kept.fileId]);
	});

	it('purges the owners of deleted files in runs of at most the budget', async () => {
		const t = harness();
		const ownersPerFile = 500;
		for (let i = 0; i < PAGE_SIZE; i++) {
			const file = await addAgentFile(t, `stale-${i}`);
			await addOwners(t, file.fileId, ownersPerFile);
		}
		vi.setSystemTime(START + 1.5 * DAY_MS);
		const fresh = await addAgentFile(t, 'fresh');
		await addOwners(t, fresh.fileId, 3);
		vi.setSystemTime(START + 2 * DAY_MS);

		await vacuum(t);

		const total = PAGE_SIZE * ownersPerFile + 3;
		expect((await ownerFileIds(t)).length).toBe(total);
		const removedPerRun: number[] = [];
		let left = total;
		while ((await pendingPurges(t)).length > 0) {
			vi.runOnlyPendingTimers();
			await t.finishInProgressScheduledFunctions();
			const now = (await ownerFileIds(t)).length;
			removedPerRun.push(left - now);
			left = now;
		}

		expect(removedPerRun.length).toBeGreaterThan(1);
		expect(Math.max(...removedPerRun)).toBeLessThanOrEqual(PURGE_BUDGET);
		expect(removedPerRun.reduce((sum, removed) => sum + removed, 0)).toBe(
			PAGE_SIZE * ownersPerFile
		);
		expect(await ownerFileIds(t)).toEqual([fresh.fileId, fresh.fileId, fresh.fileId]);
	}, 60_000);

	it('schedules a continuation when pagination is not done', async () => {
		const t = harness();
		for (let i = 0; i <= PAGE_SIZE; i++) await addAgentFile(t, `stale-${i}`);
		vi.setSystemTime(START + 2 * DAY_MS);
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

		await vacuum(t);

		expect(debug.mock.calls).toEqual([
			[`Deleting ${PAGE_SIZE} files...`],
			[`Deleted ${PAGE_SIZE} files but not done yet, continuing...`]
		]);

		expect(await scheduled(t)).toEqual([
			expect.objectContaining({ name: PURGE }),
			expect.objectContaining({
				name: 'files/vacuum:deleteUnusedFiles',
				args: [{ cursor: expect.any(String) }]
			})
		]);
	});
});
