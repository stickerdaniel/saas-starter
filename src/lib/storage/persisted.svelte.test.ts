import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type * as Svelte from 'svelte';
import { persisted } from './persisted.svelte.ts';
import { blockStorage, storageFailures } from './testing/blocked-storage.ts';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const KEY = 'test:persisted';

let cleanup: (() => void) | undefined;
let restore: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	restore?.();
	cleanup = restore = undefined;
	localStorage.clear();
	sessionStorage.clear();
});

describe.each(['local', 'session'] as const)('persisted in %sStorage', (storage) => {
	it.each(storageFailures)('keeps reactive state for the document with a %s', (failure) => {
		restore = blockStorage(storage, failure);
		const state = persisted<Record<string, string>>(KEY, {}, { storage });
		const seen: string[] = [];
		cleanup = $effect.root(() => {
			$effect(() => {
				seen.push(state.current.thread ?? '');
			});
		});
		flushSync();

		state.current = { thread: 'first' };
		flushSync();
		state.current.thread = 'second';
		flushSync();

		expect(state.current).toEqual({ thread: 'second' });
		expect(seen).toEqual(['', 'first', 'second']);
	});

	it('reads back what an earlier holder stored under the same key', () => {
		persisted(KEY, 0, { storage }).current = 5;

		expect(persisted(KEY, 0, { storage }).current).toBe(5);
	});
});
