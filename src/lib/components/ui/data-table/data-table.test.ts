import { afterEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import ReactiveTable from './test-fixtures/ReactiveTable.svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
let table: ReturnType<typeof ReactiveTable> | undefined;

afterEach(async () => {
	if (table) await unmount(table);
	document.body.replaceChildren();
});

it('keeps getter-backed rows, columns and controlled state reactive without client sorting', async () => {
	table = mount(ReactiveTable, { target: document.body });
	await tick();
	const cells = () => [...document.querySelectorAll('td')].map((cell) => cell.textContent);
	expect(cells()).toEqual(['Zulu', 'Alpha']);
	table.sort();
	table.select();
	await tick();
	expect(document.querySelector('[data-testid="sorting"]')!.textContent).toBe(
		'[{"id":"name","desc":false}]'
	);
	expect(cells()).toEqual(['Zulu', 'Alpha']);
	expect(document.querySelector('[data-testid="selected"]')!.textContent).toBe('b');
	table.replaceRows();
	table.replaceColumns();
	table.updatePageCount();
	await tick();
	expect(cells()).toEqual(['b', 'Bravo', 'c', 'Charlie']);
	expect(document.querySelector('[data-testid="pages"]')!.textContent).toBe('5');
	expect(document.querySelector('[data-testid="selected"]')!.textContent).toBe('b');
	table.hideName();
	await tick();
	expect(cells()).toEqual(['b', 'c']);
});
