import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import PromptInputHarness from './test-fixtures/PromptInputHarness.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
});

// Dispatches a synthetic Enter through the real textarea and wrapper. `false` means
// the keydown was cancelled; jsdom performs no native editing, so that is the check.
function setup() {
	const onSubmit = vi.fn();
	component = mount(PromptInputHarness, { target: document.body, props: { onSubmit } });
	flushSync();
	const field = document.body.querySelector('textarea');
	if (!field) throw new Error('Expected the prompt field');
	const pressEnter = (init: KeyboardEventInit = {}) =>
		field.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
		);
	return { onSubmit, pressEnter };
}

describe('prompt input keys', () => {
	it('sends on Enter', () => {
		const { onSubmit, pressEnter } = setup();
		expect(pressEnter()).toBe(false);
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it('does not cancel Shift+Enter or submit', () => {
		const { onSubmit, pressEnter } = setup();
		expect(pressEnter({ shiftKey: true })).toBe(true);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it.each([
		['while composing', { isComposing: true }],
		['after compositionend in Safari', { keyCode: 229 }]
	])('does not send the Enter that confirms an IME candidate %s', (_, init) => {
		const { onSubmit, pressEnter } = setup();
		expect(pressEnter(init)).toBe(true);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
