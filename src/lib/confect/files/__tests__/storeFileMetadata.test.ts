// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import { convexModules } from '../../convexTest.modules';

const URL = 'https://files.test/image.png';

describe('storeFileMetadata', () => {
	it('stores dimensions once per URL and updates them in place', async () => {
		const t = convexTest(schema, convexModules);
		const store = (width: number, height: number) =>
			t.mutation(internal.files.metadata.storeFileMetadata, {
				fileId: 'file-1',
				storageId: 'storage-1',
				url: URL,
				width,
				height
			});

		const first = await store(640, 480);
		const second = await store(1280, 960);

		expect(second).toBe(first);
		expect(await t.run(async (ctx) => await ctx.db.query('fileMetadata').take(10))).toEqual([
			expect.objectContaining({
				_id: first,
				fileId: 'file-1',
				storageId: 'storage-1',
				url: URL,
				width: 1280,
				height: 960,
				createdAt: expect.any(Number)
			})
		]);
	});
});
