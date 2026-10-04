import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import type * as Svelte from 'svelte';
import type { TableSortBy } from './contract';
import { createCursorSorting } from './sorting.svelte.ts';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

type Field = 'created_at' | 'email';

let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function setup(initial?: TableSortBy<Field>) {
	const table = $state({
		sortBy: initial,
		setSort(nextSort: TableSortBy<Field> | undefined) {
			table.sortBy = nextSort;
		}
	});
	let sorting!: ReturnType<typeof createCursorSorting<'createdAt' | 'email', Field>>;
	cleanup = $effect.root(() => {
		sorting = createCursorSorting({
			table,
			columnToField: { createdAt: 'created_at', email: 'email' }
		});
	});
	flushSync();
	return { table, sorting };
}

describe('createCursorSorting', () => {
	it('shows the URL sort on the column mapped to its field', () => {
		const { table, sorting } = setup({ field: 'created_at', direction: 'desc' });
		expect(sorting.sorting).toEqual([{ id: 'createdAt', desc: true }]);

		table.sortBy = { field: 'email', direction: 'asc' };
		expect(sorting.sorting).toEqual([{ id: 'email', desc: false }]);

		table.sortBy = undefined;
		expect(sorting.sorting).toEqual([]);
	});

	it('toggles a column through the TanStack updater', () => {
		const { table, sorting } = setup();
		sorting.onSortingChange([{ id: 'createdAt', desc: false }]);
		expect(table.sortBy).toEqual({ field: 'created_at', direction: 'asc' });

		sorting.onSortingChange((current) => current.map((sort) => ({ ...sort, desc: !sort.desc })));
		expect(table.sortBy).toEqual({ field: 'created_at', direction: 'desc' });
		expect(sorting.sorting).toEqual([{ id: 'createdAt', desc: true }]);
	});

	it('clears the sort when the column sort is cleared', () => {
		const { table, sorting } = setup({ field: 'email', direction: 'asc' });
		sorting.onSortingChange(() => []);
		expect(table.sortBy).toBeUndefined();
	});

	it('clears the sort for a column without a field', () => {
		const { table, sorting } = setup({ field: 'email', direction: 'asc' });
		sorting.onSortingChange([{ id: 'actions', desc: false }]);
		expect(table.sortBy).toBeUndefined();

		table.sortBy = { field: 'email', direction: 'asc' };
		sorting.onSortingChange([{ id: 'toString', desc: false }]);
		expect(table.sortBy).toBeUndefined();
	});
});
