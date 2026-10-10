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

async function hover() {
	trigger().dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
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
	trigger().click();
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

	describe.each(['cold', 'keyboard-first'])('%s touch', (history) => {
		it.each(['Escape', 'blur', 'outside', 'resize'])(
			'keeps complete repeated taps open until %s dismisses the text',
			async (dismiss) => {
				render(LONG);
				if (history === 'keyboard-first') {
					trigger().focus();
					await settle();
					expect(tooltip()?.textContent?.trim()).toBe(LONG);
				}

				for (let tapCount = 0; tapCount < 2; tapCount++) {
					await tap();
					expect(trigger().getAttribute('data-state')).toBe('instant-open');
					expect(tooltip()?.getAttribute('data-state')).toBe('instant-open');
					expect(tooltip()?.textContent?.trim()).toBe(LONG);
					expect(document.activeElement).toBe(trigger());
				}

				if (dismiss === 'Escape') {
					trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				} else if (dismiss === 'blur') {
					trigger().blur();
				} else if (dismiss === 'outside') {
					vi.useFakeTimers();
					for (const type of ['pointerdown', 'pointerup', 'click']) {
						document.body.dispatchEvent(
							new PointerEvent(type, {
								pointerType: 'touch',
								bubbles: true,
								clientX: 100,
								clientY: 100
							})
						);
						// Outside touch dismissal arms its click listener after pointerdown.
						await vi.runOnlyPendingTimersAsync();
					}
					vi.useRealTimers();
				} else {
					await relayout({ box: 1000 });
					expect(trigger().hasAttribute('tabindex')).toBe(false);
				}
				await settle();
				expect(trigger().getAttribute('data-state')).toBe('closed');
				expect(tooltip()).toBeNull();
			}
		);
	});

	it('preserves mouse hover into the content and mouse leave after touch', async () => {
		render(LONG);
		await tap();
		await hover();
		trigger().dispatchEvent(
			new PointerEvent('pointerleave', { pointerType: 'mouse', relatedTarget: tooltip() })
		);
		await settle();
		expect(tooltip()?.textContent?.trim()).toBe(LONG);
		expect(tooltip()?.getAttribute('data-state')).toBe('instant-open');

		tooltip()!.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
		await settle();
		expect(tooltip()).toBeNull();

		await hover();
		expect(tooltip()?.textContent?.trim()).toBe(LONG);
		trigger().dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
		await settle();
		expect(tooltip()).toBeNull();
	});

	it.each(['mouse-first', 'touch-first'])(
		'keeps full text open when the mouse resumes inside the trigger after %s touch',
		async (history) => {
			render(LONG);
			if (history === 'mouse-first') await hover();
			await tap();
			// WebKit sends this compatibility click without a new mouse pointerenter.
			trigger().dispatchEvent(new PointerEvent('click', { pointerType: 'mouse', bubbles: true }));
			trigger().dispatchEvent(
				new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true })
			);
			await settle();

			const content = tooltip()!;
			trigger().dispatchEvent(
				new PointerEvent('pointerleave', { pointerType: 'mouse', relatedTarget: content })
			);
			content.dispatchEvent(
				new PointerEvent('pointerenter', { pointerType: 'mouse', relatedTarget: trigger() })
			);
			await settle();

			expect(trigger().getAttribute('data-state')).toBe('instant-open');
			expect(tooltip()?.getAttribute('data-state')).toBe('instant-open');
			expect(tooltip()?.textContent?.trim()).toBe(LONG);

			content.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
			await settle();
			expect(tooltip()).toBeNull();
		}
	);

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
