import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { ConvexClient } from 'convex/browser';
import ChatTestProvider from '#lib/chat/ui/test-fixtures/ChatTestProvider.svelte';
import ScreenshotToolbar from './ScreenshotToolbar.svelte';
import {
	ScreenshotEditorState,
	screenshotEditorContext
} from './screenshot-editor-context.svelte.ts';

// Vitest resolves Svelte's server entry by default; mount with its real client runtime.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

let component: ReturnType<typeof mount> | undefined;
let client: ConvexClient;
const resizeCallbacks = new Set<() => void>();

beforeEach(() => {
	client = new ConvexClient('https://toolbar-test.convex.cloud', { disabled: true });
	vi.spyOn(screenshotEditorContext, 'get').mockImplementation(() => new ScreenshotEditorState({}));
	// jsdom has no ResizeObserver or layout; deliver palette resizes explicitly.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(private callback: () => void) {}
			observe() {
				resizeCallbacks.add(this.callback);
			}
			unobserve() {}
			disconnect() {
				resizeCallbacks.delete(this.callback);
			}
		}
	);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	await client.close();
	document.body.replaceChildren();
	document.documentElement.scrollTop = 0;
	resizeCallbacks.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it('reveals the selected color on resize or selection without moving focus or the document', async () => {
	component = mount(ChatTestProvider<Record<string, never>>, {
		target: document.body,
		props: { client, content: ScreenshotToolbar, contentProps: {} }
	});
	await tick();
	const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!;
	const palette = group.parentElement!;
	const swatches = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
	const red = swatches.find((swatch) => swatch.getAttribute('aria-label') === 'Red')!;
	const black = swatches.find((swatch) => swatch.getAttribute('aria-label') === 'Black')!;
	const rectangle = document.querySelector<HTMLButtonElement>(
		'button[aria-label="Rectangle (R)"]'
	)!;

	// Real 375x500 browser measurement: palette y302..451, Black y466..490 before
	// scrolling. Swatches are 24px high, 32px apart, with 4px of ring clearance.
	let height = 192;
	Object.defineProperty(palette, 'clientHeight', { configurable: true, get: () => height });
	palette.style.scrollPaddingTop = '4px';
	palette.style.scrollPaddingBottom = '4px';
	vi.spyOn(palette, 'getBoundingClientRect').mockImplementation(
		() => new DOMRect(318, 302, 32, height)
	);
	for (const [index, swatch] of swatches.entries()) {
		vi.spyOn(swatch, 'getBoundingClientRect').mockImplementation(
			() => new DOMRect(322, 306 + index * 32 - palette.scrollTop, 24, 24)
		);
	}
	let scrollTop = 0;
	const scroll = vi.fn((value: number) => {
		scrollTop = value;
	});
	Object.defineProperty(palette, 'scrollTop', {
		configurable: true,
		get: () => scrollTop,
		set: scroll
	});
	document.documentElement.scrollTop = 120;
	const scrollWindow = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
	black.click();
	rectangle.click();
	rectangle.focus();
	await tick();
	const focus = vi.spyOn(HTMLElement.prototype, 'focus');
	expect(black.getAttribute('aria-checked')).toBe('true');
	expect(scroll).not.toHaveBeenCalled();

	function expectVisible(swatch: HTMLElement) {
		const bounds = palette.getBoundingClientRect();
		const selected = swatch.getBoundingClientRect();
		expect(selected.top).toBeGreaterThanOrEqual(bounds.top + 4);
		expect(selected.bottom).toBeLessThanOrEqual(bounds.bottom - 4);
		expect(selected.top).toBeGreaterThanOrEqual(0);
		expect(selected.bottom).toBeLessThanOrEqual(500);
		expect(document.activeElement).toBe(rectangle);
		expect(document.documentElement.scrollTop).toBe(120);
		expect(scrollWindow).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
	}

	height = 149;
	for (const callback of resizeCallbacks) callback();
	await tick();
	expect(palette.scrollTop).toBe(43);
	expectVisible(black);

	// A second delivery for an already visible selection must not scroll again.
	scroll.mockClear();
	for (const callback of resizeCallbacks) callback();
	await tick();
	expect(scroll).not.toHaveBeenCalled();

	red.click();
	await tick();
	expect(red.getAttribute('aria-checked')).toBe('true');
	expect(palette.scrollTop).toBe(0);
	expectVisible(red);

	black.click();
	await tick();
	expect(black.getAttribute('aria-checked')).toBe('true');
	expect(palette.scrollTop).toBe(43);
	expectVisible(black);
});
