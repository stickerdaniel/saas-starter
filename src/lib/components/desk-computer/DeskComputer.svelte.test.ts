import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import DeskComputer from './DeskComputer.svelte';

let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
	vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
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
const click = (key: number) =>
	document
		.querySelector(`[data-key="${key}"]`)
		?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

it('rests on the first CLI command under reduced motion, and a clicked key types', async () => {
	component = mount(DeskComputer, { target: document.body });
	flushSync();
	await vi.waitFor(() => expect(screen()).toBe('> bun create saas-starter'), { timeout: 5000 });

	click(BACKSPACE);
	click(Q);
	expect(screen()).toBe('> bun create saas-starteq');
});
