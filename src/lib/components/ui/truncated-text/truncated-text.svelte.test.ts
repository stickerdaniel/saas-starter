import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
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
	vi.useRealTimers();
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
const popover = () => document.querySelector<HTMLElement>('[data-slot="popover-content"]');

async function settle() {
	flushSync();
	await tick();
	// Pointer-leave safety closes on the next frame. Let that callback and the
	// resulting render finish before asserting open state, not an exiting tooltip.
	await new Promise(requestAnimationFrame);
	await tick();
	await Promise.all(document.getAnimations?.().map((animation) => animation.finished) ?? []);
	flushSync();
}

async function hover(pointerType = 'mouse') {
	trigger().dispatchEvent(new PointerEvent('pointerenter', { pointerType }));
	await settle();
}

async function tap() {
	for (const type of ['pointerenter', 'pointerdown', 'pointerup', 'pointerleave']) {
		trigger().dispatchEvent(
			new PointerEvent(type, {
				pointerType: 'touch',
				bubbles: type === 'pointerdown' || type === 'pointerup',
				cancelable: type === 'pointerdown' || type === 'pointerup'
			})
		);
	}
	trigger().focus();
	trigger().dispatchEvent(
		new PointerEvent('click', { pointerType: 'touch', bubbles: true, cancelable: true })
	);
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

	async function outsideTap() {
		vi.useFakeTimers();
		for (const type of ['pointerdown', 'pointerup', 'click']) {
			document.body.dispatchEvent(
				new PointerEvent(type, { pointerType: 'touch', bubbles: true, clientX: 100, clientY: 100 })
			);
			// Outside touch dismissal arms its click listener after pointerdown.
			await vi.runOnlyPendingTimersAsync();
		}
		vi.useRealTimers();
		await settle();
	}

	async function press(key: string) {
		trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		await settle();
	}

	describe.each(['cold', 'keyboard-first'])('%s touch', (history) => {
		async function renderTouched() {
			render(LONG);
			if (history === 'keyboard-first') {
				trigger().focus();
				await settle();
				expect(tooltip()?.textContent?.trim()).toBe(LONG);
			}
			await tap();
			expect(popover()?.textContent?.trim()).toBe(LONG);
			expect(tooltip()).toBeNull();
			expect(document.activeElement).toBe(trigger());
		}

		it('opens the full text with a tap and closes it with a second tap', async () => {
			await renderTouched();

			await tap();
			expect(popover()).toBeNull();
			expect(tooltip()).toBeNull();

			await tap();
			expect(popover()?.textContent?.trim()).toBe(LONG);
		});

		it.each(['Escape', 'outside'])('closes the full text on %s', async (dismiss) => {
			await renderTouched();

			if (dismiss === 'Escape') await press('Escape');
			else await outsideTap();

			expect(popover()).toBeNull();
			expect(tooltip()).toBeNull();
			expect(document.activeElement).toBe(trigger());
		});

		it('closes the full text and stops responding once the text fits', async () => {
			await renderTouched();

			await relayout({ box: 1000 });
			expect(popover()).toBeNull();
			expect(trigger().hasAttribute('tabindex')).toBe(false);

			await tap();
			expect(popover()).toBeNull();
			expect(tooltip()).toBeNull();
		});
	});

	it('neither takes nor returns focus when the full text opens and closes', async () => {
		render(LONG);
		const elsewhere = document.createElement('button');
		document.body.append(elsewhere);

		await tap();
		expect(popover()?.textContent?.trim()).toBe(LONG);
		expect(document.activeElement).toBe(trigger());

		elsewhere.focus();
		await outsideTap();
		expect(popover()).toBeNull();
		expect(document.activeElement).toBe(elsewhere);
	});

	it('hands the full text to the mouse after a touch', async () => {
		render(LONG);
		await tap();
		expect(popover()?.textContent?.trim()).toBe(LONG);

		await hover();
		expect(tooltip()?.textContent?.trim()).toBe(LONG);
		expect(popover()).toBeNull();

		trigger().dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
		await settle();
		expect(tooltip()).toBeNull();
		expect(popover()).toBeNull();
	});

	it('keeps a mouse click on the hover tooltip', async () => {
		render(LONG);
		await hover();
		trigger().dispatchEvent(
			new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true, cancelable: true })
		);
		trigger().click();
		await settle();

		expect(tooltip()?.textContent?.trim()).toBe(LONG);
		expect(popover()).toBeNull();
	});

	it.each(['before', 'after'])(
		'shows only the tooltip to the keyboard and opens nothing on Enter or Space %s a touch',
		async (history) => {
			render(LONG);
			if (history === 'after') {
				await tap();
				await tap();
				expect(popover()).toBeNull();
				trigger().blur();
			}
			trigger().focus();
			await settle();

			for (const key of ['Enter', ' ']) {
				await press(key);
				expect(tooltip()?.textContent?.trim()).toBe(LONG);
				expect(popover()).toBeNull();
				expect(document.activeElement).toBe(trigger());
			}
			for (const attribute of ['aria-haspopup', 'aria-expanded', 'aria-controls', 'role']) {
				expect(trigger().hasAttribute(attribute)).toBe(false);
			}
			expect(trigger().textContent).toBe(LONG);
		}
	);

	it.each(['a second tap', 'Escape'])(
		'opens nothing on a click without a new touch after %s closed it',
		async (closer) => {
			render(LONG);
			await tap();
			expect(popover()?.textContent?.trim()).toBe(LONG);
			if (closer === 'Escape') await press('Escape');
			else await tap();
			expect(popover()).toBeNull();

			trigger().click();
			await settle();
			expect(popover()).toBeNull();
		}
	);

	it.each([
		['a synthetic click', () => new PointerEvent('click', { bubbles: true })],
		['a click without a pointer type', () => new MouseEvent('click', { bubbles: true })]
	])('opens nothing on %s after a touch press', async (_name, click) => {
		render(LONG);
		for (const type of ['pointerdown', 'pointerup']) {
			trigger().dispatchEvent(new PointerEvent(type, { pointerType: 'touch', bubbles: true }));
		}
		trigger().dispatchEvent(click());
		await settle();
		expect(popover()).toBeNull();
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
