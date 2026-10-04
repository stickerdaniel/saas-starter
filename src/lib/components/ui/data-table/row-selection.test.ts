import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import SelectionTable from './test-fixtures/SelectionTable.svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

let table: ReturnType<typeof SelectionTable> | undefined;

afterEach(async () => {
	if (table) await unmount(table);
	table = undefined;
	document.body.replaceChildren();
});

function render(ids: string[]) {
	table = mount(SelectionTable, { target: document.body, props: { ids } });
	flushSync();
	return table;
}

function act(change: () => void) {
	change();
	flushSync();
}

const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.textContent;
const selected = () => text('state');
const selectedRows = () =>
	[...document.querySelectorAll('tr[data-state="selected"]')].map((row) => row.textContent);

describe('row selection', () => {
	it('follows row and page toggles', () => {
		const t = render(['a', 'b', 'c']);

		act(() => t.toggleRow('b'));
		expect(selected()).toBe('b');
		expect(text('count')).toBe('1');
		expect(selectedRows()).toEqual(['b']);

		act(() => t.togglePage(true));
		expect(selected()).toBe('a,b,c');
		expect(text('count')).toBe('3');

		act(() => t.toggleRow('a', false));
		expect(selected()).toBe('b,c');

		act(() => t.togglePage(false));
		expect(selected()).toBe('');
		expect(text('count')).toBe('0');
	});

	it('accepts direct and functional updaters', () => {
		const t = render(['a', 'b', 'c']);

		act(() => t.setSelection({ a: true, c: true }));
		expect(selected()).toBe('a,c');

		act(() => t.setSelection((old) => ({ ...old, b: true })));
		expect(selected()).toBe('a,b,c');

		act(() => t.setSelection({ b: true }));
		expect(selected()).toBe('b');
		expect(selectedRows()).toEqual(['b']);
	});

	it('drops a selected row that is deleted, also when it comes back', () => {
		const t = render(['a', 'b', 'c']);
		act(() => t.setSelection({ b: true, c: true }));

		act(() => t.setRows(['a', 'c']));
		expect(selected()).toBe('c');
		expect(text('count')).toBe('1');

		act(() => t.setRows(['a', 'b', 'c']));
		expect(selected()).toBe('c');
		expect(selectedRows()).toEqual(['c']);
	});

	it('does not resurrect a selection when an earlier page returns', () => {
		const t = render(['a1', 'a2']);
		act(() => t.toggleRow('a1'));

		act(() => t.setRows(['b1', 'b2']));
		expect(selected()).toBe('');
		expect(text('count')).toBe('0');

		act(() => t.setRows(['a1', 'a2']));
		expect(selected()).toBe('');
		expect(text('count')).toBe('0');
		expect(selectedRows()).toEqual([]);
	});

	it('keeps rows that stay through a re-sort or a narrower filter', () => {
		const t = render(['a', 'b', 'c']);
		act(() => t.setSelection({ a: true, b: true }));

		act(() => t.setRows(['c', 'b', 'a']));
		expect(selected()).toBe('a,b');
		expect(selectedRows()).toEqual(['b', 'a']);

		act(() => t.setRows(['b', 'd']));
		expect(selected()).toBe('b');
		expect(text('count')).toBe('1');
	});
});
