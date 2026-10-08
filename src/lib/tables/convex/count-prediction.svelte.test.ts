import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type * as Svelte from 'svelte';
import { PersistedState } from 'runed';
import { createCountPrediction } from './count-prediction.svelte.ts';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const PAGE_SIZE = 10;

let cleanup: (() => void) | undefined;

beforeEach(() => localStorage.clear());

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	localStorage.clear();
});

function predict(cache: PersistedState<number | null>) {
	const table = $state({
		totalCount: 0,
		hasLoadedCount: false,
		isUnfiltered: true,
		pageIndex: 0,
		pageSize: PAGE_SIZE
	});
	let prediction!: ReturnType<typeof createCountPrediction>;
	cleanup = $effect.root(() => {
		prediction = createCountPrediction({ table, cache });
	});
	flushSync();
	return { table, prediction };
}

function storedCache(value: number | null) {
	if (value !== null) localStorage.setItem('test:count', JSON.stringify(value));
	return new PersistedState<number | null>('test:count', null);
}

describe('count prediction', () => {
	it('predicts a cold load from the cache without overwriting it', () => {
		const cache = storedCache(25);
		const { table, prediction } = predict(cache);

		expect(prediction.skeletonRows).toBe(PAGE_SIZE);
		expect(prediction.total).toBe(25);
		table.pageIndex = 2;
		flushSync();
		expect(prediction.skeletonRows).toBe(5);
		expect(cache.current).toBe(25);
		expect(JSON.parse(localStorage.getItem('test:count')!)).toBe(25);
	});

	it('persists a loaded zero for the unfiltered query and predicts an empty page', () => {
		const cache = storedCache(7);
		const { table, prediction } = predict(cache);

		table.hasLoadedCount = true;
		flushSync();

		expect(cache.current).toBe(0);
		expect(JSON.parse(localStorage.getItem('test:count')!)).toBe(0);
		expect(prediction.skeletonRows).toBe(0);
		expect(prediction.total).toBe(0);
	});

	it('never persists or predicts from a filtered query', () => {
		const cache = storedCache(25);
		const { table, prediction } = predict(cache);

		table.isUnfiltered = false;
		flushSync();
		expect(prediction.skeletonRows).toBe(PAGE_SIZE);
		expect(prediction.total).toBe(0);

		table.totalCount = 3;
		table.hasLoadedCount = true;
		flushSync();
		expect(cache.current).toBe(25);
		expect(prediction.skeletonRows).toBe(PAGE_SIZE);
		expect(prediction.total).toBe(3);
	});

	it('ignores a count stored under a pre-v2 admin cache key', async () => {
		// The old keys could hold a filtered count, such as an empty search result.
		for (const key of ['userCount', 'auditLogCount', 'recipientCount']) {
			localStorage.setItem(`admin-cache:${key}`, '0');
		}
		vi.resetModules();
		const { adminCache } = await import('#lib/hooks/admin-cache.svelte.ts');

		for (const cache of [
			adminCache.userCount,
			adminCache.auditLogCount,
			adminCache.recipientCount
		]) {
			const { prediction } = predict(cache);
			expect(prediction.skeletonRows).toBe(PAGE_SIZE);
			cleanup?.();
			cleanup = undefined;
		}
	});
});
