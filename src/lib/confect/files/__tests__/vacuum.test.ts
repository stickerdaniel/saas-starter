// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import agentSchema from '../../../../../node_modules/@convex-dev/agent/dist/component/schema.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import { convexModules, preloadModules } from '../../convexTest.modules';

const agentModules = await preloadModules(
	import.meta.glob('../../../../../node_modules/@convex-dev/agent/dist/component/**/*.js')
);

const DAY_MS = 1000 * 60 * 60 * 24;
const START = Date.UTC(2026, 9, 8, 12);
const PAGE_SIZE = 100;

const harness = () => {
	const t = convexTest(schema, convexModules);
	t.registerComponent('agent', agentSchema, agentModules);
	return t;
};
type Harness = ReturnType<typeof harness>;

async function addAgentFile(t: Harness, hash: string) {
	const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([hash])));
	await t.mutation(components.agent.files.addFile, { storageId, hash, filename: `${hash}.png` });
	return storageId;
}

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

const vacuum = (t: Harness) => t.mutation(internal.files.vacuum.deleteUnusedFiles, {});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('files vacuum', () => {
	it('cascade-deletes fileMetadata rows for vacuumed files', async () => {
		const t = harness();
		const stale = await addAgentFile(t, 'stale');
		await addMetadata(t, stale, 'https://files.test/stale-1');
		await addMetadata(t, stale, 'https://files.test/stale-2');
		await addMetadata(t, 'storage_other', 'https://files.test/other');
		vi.setSystemTime(START + 2 * DAY_MS);

		await vacuum(t);

		expect(await storedBlob(t, stale)).toBeNull();
		expect(await metadataStorageIds(t)).toEqual(['storage_other']);
		const remaining = await t.query(components.agent.files.getFilesToDelete, {
			paginationOpts: { cursor: null, numItems: 10 }
		});
		expect(remaining.page).toEqual([]);
		expect(await scheduled(t)).toEqual([]);
	});

	it('deletes the owner rows of vacuumed files only', async () => {
		const t = harness();
		const { fileId: stale } = await t.mutation(components.agent.files.addFile, {
			storageId: await t.run(async (ctx) => await ctx.storage.store(new Blob(['stale']))),
			hash: 'stale'
		});
		for (const fileId of [stale, 'file_other']) {
			await t.mutation(internal.files.owners.grantFileOwner, { fileId, ownerId: 'user_1' });
		}
		vi.setSystemTime(START + 2 * DAY_MS);

		await vacuum(t);

		const owners = await t.run(async (ctx) => await ctx.db.query('fileOwners').take(10));
		expect(owners.map((row) => row.fileId)).toEqual(['file_other']);
	});

	it('keeps fileMetadata for recently touched files', async () => {
		const t = harness();
		const fresh = await addAgentFile(t, 'fresh');
		await addMetadata(t, fresh, 'https://files.test/fresh');

		await vacuum(t);

		expect(await storedBlob(t, fresh)).not.toBeNull();
		expect(await metadataStorageIds(t)).toEqual([fresh]);
	});

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
			expect.objectContaining({
				name: 'files/vacuum:deleteUnusedFiles',
				args: [{ cursor: expect.any(String) }]
			})
		]);
	});
});
