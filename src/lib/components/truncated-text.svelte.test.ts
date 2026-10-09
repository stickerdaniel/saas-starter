import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import TruncatedText from './truncated-text.svelte';

const TEST_ID = 'truncated-text';
const LONG = 'a-deliberately-long-mailbox@e2e.example.com';

// jsdom lays nothing out. Model the one measurement the component reads: the text
// needs characters times glyph width, the clamped element gets the box width.
const layout = { box: 100, glyph: 8 };
const resizeCallbacks = new Set<(entries: ResizeObserverEntry[]) => void>();
let fonts: EventTarget & { ready: Promise<void> };
let resolveFontsReady: () => void;

beforeEach(() => {
	layout.box = 100;
	layout.glyph = 8;
	const measured = (element: HTMLElement) => element.dataset.testid === TEST_ID;
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
		this: HTMLElement
	) {
		return measured(this) ? layout.box : 0;
	});
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
		this: HTMLElement
	) {
		if (!measured(this)) return 0;
		return Math.max(layout.box, (this.textContent?.length ?? 0) * layout.glyph);
	});
	vi.stubGlobal(
		'ResizeObserver',
		class {
			#callback: (entries: ResizeObserverEntry[]) => void;
			constructor(callback: (entries: ResizeObserverEntry[]) => void) {
				this.#callback = callback;
			}
			observe() {
				resizeCallbacks.add(this.#callback);
			}
			unobserve() {}
			disconnect() {
				resizeCallbacks.delete(this.#callback);
			}
		}
	);
	fonts = Object.assign(new EventTarget(), {
		ready: new Promise<void>((resolve) => (resolveFontsReady = resolve))
	});
	Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
});

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
	resizeCallbacks.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function render(text: string) {
	const props = $state({ text, testId: TEST_ID });
	component = mount(TruncatedText, { target: document.body, props });
	flushSync();
	return props;
}

const trigger = () => document.querySelector<HTMLElement>(`[data-testid="${TEST_ID}"]`)!;
const tooltip = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

async function settle() {
	flushSync();
	await tick();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

async function hover() {
	trigger().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
	await settle();
}

async function relayout(change: Partial<typeof layout>) {
	Object.assign(layout, change);
	for (const callback of resizeCallbacks) callback([]);
	await settle();
}

describe('TruncatedText', () => {
	it('opens the full text on the first hover once the text is clipped', async () => {
		layout.box = 1000;
		render(LONG);
		// The box narrows after the last observation; the hover alone has to notice.
		layout.box = 60;
		await hover();

		expect(tooltip()?.textContent?.trim()).toBe(LONG);
	});

	it.each([
		{ fit: 'shorter than', text: 'short', box: 100 },
		{ fit: 'exactly as wide as', text: 'ten-chars!', box: 80 }
	])('stays passive text when it is $fit its box', async ({ text, box }) => {
		layout.box = box;
		render(text);

		await hover();
		trigger().focus();
		await settle();

		expect(tooltip()).toBeNull();
		expect(trigger().hasAttribute('tabindex')).toBe(false);
		expect(document.activeElement).not.toBe(trigger());
	});

	it('lets keyboard focus open clipped text', async () => {
		render(LONG);

		expect(trigger().getAttribute('tabindex')).toBe('0');
		trigger().focus();
		await settle();
		expect(tooltip()?.textContent?.trim()).toBe(LONG);

		trigger().blur();
		await settle();
		expect(tooltip()).toBeNull();
	});

	it.each(['Escape', 'blur'])('keeps tapped text open until %s dismisses it', async (dismiss) => {
		render(LONG);

		// Touch focuses after pointerup, then emits a click. That click must not
		// immediately dismiss the full value that focus just opened.
		trigger().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
		trigger().dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
		trigger().dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }));
		trigger().focus();
		await settle();
		trigger().click();
		await settle();

		expect(tooltip()?.textContent?.trim()).toBe(LONG);
		expect(tooltip()?.getAttribute('data-state')).toBe('instant-open');

		// A second tap while reading must preserve the disclosure too.
		trigger().dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
		trigger().dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }));
		trigger().click();
		await settle();
		expect(tooltip()?.getAttribute('data-state')).toBe('instant-open');

		if (dismiss === 'Escape') {
			trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		} else {
			trigger().blur();
		}
		await settle();
		expect(tooltip()).toBeNull();
	});

	it('follows text changes', async () => {
		const props = render(LONG);
		await hover();
		expect(tooltip()).not.toBeNull();

		props.text = 'short';
		await settle();
		expect(tooltip()).toBeNull();
		expect(trigger().hasAttribute('tabindex')).toBe(false);

		props.text = `${LONG}-again`;
		await settle();
		expect(trigger().getAttribute('tabindex')).toBe('0');
		await hover();
		expect(tooltip()?.textContent?.trim()).toBe(`${LONG}-again`);
	});

	it('closes when a resize lets the text fit', async () => {
		render(LONG);
		await hover();
		expect(tooltip()).not.toBeNull();

		await relayout({ box: 1000 });
		expect(tooltip()).toBeNull();
		expect(trigger().hasAttribute('tabindex')).toBe(false);
	});

	it('remeasures when the web font arrives and when a later font loads', async () => {
		// The narrow fallback fits; the loaded font does not.
		layout.glyph = 2;
		render(LONG);
		expect(trigger().hasAttribute('tabindex')).toBe(false);

		layout.glyph = 8;
		resolveFontsReady();
		await settle();
		expect(trigger().getAttribute('tabindex')).toBe('0');

		await hover();
		expect(tooltip()).not.toBeNull();
		layout.glyph = 2;
		fonts.dispatchEvent(new Event('loadingdone'));
		await settle();
		expect(tooltip()).toBeNull();
		expect(trigger().hasAttribute('tabindex')).toBe(false);
	});
});
