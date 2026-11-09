import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import DeskComputer from './DeskComputer.svelte';

let component: ReturnType<typeof mount> | undefined;

// A reduced-motion media query whose preference the test can flip at runtime.
const motion = new (class extends EventTarget {
	reduced = false;
	get matches() {
		return this.reduced;
	}
	set(reduced: boolean) {
		this.reduced = reduced;
		this.dispatchEvent(Object.assign(new Event('change'), { matches: reduced }));
	}
})();

beforeEach(() => {
	motion.reduced = false;
	vi.stubGlobal('matchMedia', () => motion);
	vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback));
	vi.stubGlobal('cancelIdleCallback', (id: number) => clearTimeout(id));
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
	// jsdom does no SVG text layout.
	Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
		configurable: true,
		value: () => 0
	});
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	vi.unstubAllGlobals();
	Reflect.deleteProperty(SVGElement.prototype, 'getComputedTextLength');
	document.body.replaceChildren();
});

// The figure numbers its keys row by row: Backspace ends the number row, q follows Tab.
const BACKSPACE = 13;
const Q = 15;

const screen = () => document.querySelector('svg text')?.textContent;
const blinking = () =>
	document.querySelector('[data-part="cursor"]')?.hasAttribute('data-blink') ?? false;
const click = (key: number) =>
	document
		.querySelector(`[data-key="${key}"]`)
		?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

it('fills the stylesheet frame with the live figure once the browser is idle', async () => {
	let idle: (() => void) | undefined;
	vi.stubGlobal('requestIdleCallback', (callback: () => void) => ((idle = callback), 1));
	component = mount(DeskComputer, { target: document.body });
	flushSync();
	const host = document.querySelector('.desk-computer')!;
	expect(host.childElementCount).toBe(0);

	idle!();
	await vi.waitFor(() => expect(host.querySelector('svg [data-part="cursor"]')).not.toBeNull(), {
		timeout: 5000
	});
});

it('keeps an unmounted host empty when the live figure arrives late', async () => {
	let idle: (() => void) | undefined;
	vi.stubGlobal('requestIdleCallback', (callback: () => void) => ((idle = callback), 1));
	component = mount(DeskComputer, { target: document.body });
	flushSync();
	const host = document.querySelector('.desk-computer')!;

	idle!();
	await unmount(component);
	component = undefined;
	await import('./desk-computer.js');
	await new Promise((resolve) => setTimeout(resolve));
	expect(host.childElementCount).toBe(0);
});

it('rests on the first CLI command under reduced motion, and a clicked key types', async () => {
	motion.reduced = true;
	component = mount(DeskComputer, { target: document.body });
	flushSync();
	await vi.waitFor(() => expect(screen()).toBe('> bun create saas-starter'), { timeout: 5000 });

	click(BACKSPACE);
	click(Q);
	expect(screen()).toBe('> bun create saas-starteq');
});

it('settles on the first CLI command when reduced motion turns on mid-tour', async () => {
	component = mount(DeskComputer, { target: document.body });
	flushSync();
	// The cursor blinks once the tour runs.
	await vi.waitFor(() => expect(blinking()).toBe(true), { timeout: 5000 });

	motion.set(true);
	expect(screen()).toBe('> bun create saas-starter');
	expect(blinking()).toBe(false);
});
