import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type { ConvexClient } from 'convex/browser';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { ConvexCursorTableState } from './create-convex-cursor-table.svelte.ts';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/environment', () => ({ browser: true, building: false }));
const routing = vi.hoisted(() => ({
	getUrl: () => new URL('https://example.com/users'),
	goto: vi.fn(async (_href: string) => {})
}));
vi.mock('$app/navigation', () => ({ goto: routing.goto }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return routing.getUrl();
		}
	}
}));

import CursorTableHarness from './test-fixtures/CursorTableHarness.svelte';

let component: { table: ConvexCursorTableState<string, 'name', 'role'> } | undefined;

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

it('keeps the total through page navigation and updates it for changed filters', async () => {
	let url = $state.raw(new URL('https://example.com/users'));
	routing.getUrl = () => url;
	const results = new Map<string, unknown>();
	const pending: Array<() => void> = [];
	const resolve = (name: string, args: { cursor?: string; role: string }) =>
		name === 'test:count'
			? args.role === 'admin'
				? 0
				: 12
			: { items: ['user'], continueCursor: args.cursor ? null : 'last', isDone: !!args.cursor };
	const key = (name: string, args: unknown) => JSON.stringify([name, args]);
	const client = {
		disabled: false,
		closed: false,
		client: { localQueryResult: (name: string, args: unknown) => results.get(key(name, args)) },
		onUpdate: (
			query: FunctionReference<'query'>,
			args: { cursor?: string; role: string },
			callback: (value: unknown) => void
		) => {
			const name = getFunctionName(query);
			const queryKey = key(name, args);
			let active = true;
			// Convex drops the local result when its last subscriber leaves, then delivers
			// the server result asynchronously, even if that numeric result is unchanged.
			pending.push(() => {
				if (!active) return;
				const value = resolve(name, args);
				results.set(queryKey, value);
				callback(value);
			});
			return () => {
				active = false;
				results.delete(queryKey);
			};
		},
		query: async (query: FunctionReference<'query'>, args: { cursor?: string; role: string }) =>
			resolve(getFunctionName(query), args)
	};
	const deliver = () => {
		flushSync();
		for (const callback of pending.splice(0)) callback();
		flushSync();
	};

	component = mount(CursorTableHarness, {
		target: document.body,
		props: { client: client as unknown as ConvexClient }
	});
	deliver();
	expect(document.body.textContent).toContain('Page 1 of 12');
	expect(component.table.isUnfiltered).toBe(true);

	await component.table.goLast();
	flushSync();
	// SvelteKit commits the URL after Runed has already updated its local cache.
	flushSync(() => {
		url = new URL(routing.goto.mock.lastCall![0], url);
	});
	deliver();
	expect(document.body.textContent).toContain('Page 12 of 12');

	component.table.setFilter('role', 'admin');
	deliver();
	expect(component.table.totalCount).toBe(0);
	expect(component.table.hasLoadedCount).toBe(true);
	expect(component.table.isUnfiltered).toBe(false);
	expect(document.body.textContent).toContain('Page 1 of 1');
});
