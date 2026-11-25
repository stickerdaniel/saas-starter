// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import filesControl from '@gilhrpenner/convex-files-control/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { components, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { convexModules } from '../convexTest.modules';

const START = Date.UTC(2026, 9, 8, 12);
const DAY_MS = 1000 * 60 * 60 * 24;

const harness = () => {
	const t = convexTest(schema, convexModules);
	filesControl.register(t);
	return t;
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('expired file cleanup', () => {
	it.each([
		[1, 2, false],
		[2, 1, true]
	])(
		'leaves continuation ownership to the component (%i expired, limit %i, hasMore=%s)',
		async (expired, limit, hasMore) => {
			const t = harness();
			for (let i = 0; i < expired; i++) {
				await t.mutation(components.convexFilesControl.upload.generateUploadUrl, {
					provider: 'convex'
				});
			}
			vi.setSystemTime(START + DAY_MS);

			await expect(
				t.mutation(internal.files.cleanup.cleanupExpiredFiles, { limit })
			).resolves.toEqual({ deletedCount: 1, hasMore });

			const scheduled = await t.run(
				async (ctx) => await ctx.db.system.query('_scheduled_functions').take(10)
			);
			expect(scheduled, 'The component must be the only cleanup scheduler').toEqual([]);
		}
	);
});
