import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import ReactiveTable from './test-fixtures/ReactiveTable.svelte';
import DefaultTextTable, { type TextTableOptions } from './test-fixtures/DefaultTextTable.svelte';
import NameCell from './test-fixtures/NameCell.svelte';
import { renderComponent } from './index.js';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
let table: ReturnType<typeof ReactiveTable> | undefined;

afterEach(async () => {
	if (table) await unmount(table);
	table = undefined;
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

describe('columns without their own cell renderer', () => {
	const LONG = 'a-deliberately-long-mailbox@e2e.example.com';

	// jsdom lays nothing out. Model a column 100px wide: whatever a cell renders
	// directly gets that box, and its text needs 8px per character.
	beforeEach(() => {
		const inCell = (element: HTMLElement) => element.parentElement?.tagName === 'TD';
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
			this: HTMLElement
		) {
			return inCell(this) ? 100 : 0;
		});
		vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
			this: HTMLElement
		) {
			return inCell(this) ? Math.max(100, (this.textContent?.length ?? 0) * 8) : 0;
		});
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			}
		);
	});

	let textTable: ReturnType<typeof mount> | undefined;

	afterEach(() => {
		if (textTable) unmount(textTable);
		textTable = undefined;
		document.body.replaceChildren();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	async function settle() {
		flushSync();
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		flushSync();
	}

	async function render(options: Partial<TextTableOptions>) {
		textTable = mount(DefaultTextTable, {
			target: document.body,
			props: {
				options: {
					data: [],
					columns: [{ accessorKey: 'value' }],
					getRowId: (row) => row.id,
					...options
				}
			}
		});
		await settle();
	}

	const cell = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
	const text = (id: string) => cell(id).textContent?.trim();
	// The element a cell renders, or the cell itself for plain text.
	const target = (id: string) => (cell(id).firstElementChild as HTMLElement | null) ?? cell(id);
	const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

	async function hover(id: string) {
		target(id).dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
		await settle();
	}

	function expectPassive(id: string) {
		expect(tooltip()).toBeNull();
		expect(cell(id).querySelector('[tabindex]')).toBeNull();
	}

	it('reveal clipped text on hover and keyboard focus', async () => {
		await render({ data: [{ id: 'row', value: LONG }] });

		expect(text('row')).toBe(LONG);
		await hover('row');
		expect(tooltip()?.textContent?.trim()).toBe(LONG);

		target('row').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
		await settle();
		expect(tooltip()).toBeNull();
		expect(target('row').getAttribute('tabindex')).toBe('0');
		target('row').focus();
		await settle();
		expect(tooltip()?.textContent?.trim()).toBe(LONG);
	});

	it('keep fitting text passive', async () => {
		await render({ data: [{ id: 'row', value: 'short' }] });

		await hover('row');
		target('row').focus();
		await settle();

		expect(text('row')).toBe('short');
		expectPassive('row');
		expect(document.activeElement).toBe(document.body);
	});

	it('leave a column renderer in charge of its cell', async () => {
		await render({
			data: [{ id: 'row', value: LONG }],
			columns: [
				{
					accessorKey: 'value',
					cell: ({ row }) => renderComponent(NameCell, { name: String(row.original.value) })
				}
			]
		});

		await hover('row');
		expect(text('row')).toBe(LONG);
		expectPassive('row');
	});

	it('let a caller default column replace the text default', async () => {
		await render({
			data: [{ id: 'row', value: LONG }],
			defaultColumn: { cell: ({ renderValue }) => `plain ${String(renderValue())}` }
		});

		await hover('row');
		expect(text('row')).toBe(`plain ${LONG}`);
		expectPassive('row');
	});

	it.each([
		{ fallback: undefined, missing: '' },
		{ fallback: 'n/a', missing: 'n/a' }
	])('stringify values like TanStack with fallback $fallback', async ({ fallback, missing }) => {
		await render({
			data: [
				{ id: 'zero', value: 0 },
				{ id: 'false', value: false },
				{ id: 'empty', value: '' },
				{ id: 'missing' }
			],
			renderFallbackValue: fallback
		});

		expect(text('zero')).toBe('0');
		expect(text('false')).toBe('false');
		expect(text('empty')).toBe('');
		expect(text('missing')).toBe(missing);
	});
});
