import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import InlineEmailPrompt from './InlineEmailPrompt.svelte';

// Vitest resolves Svelte's server entry by default; use its real client runtime for mounting.
vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

function renderPrompt() {
	const onSubmitEmail = vi.fn(async () => {});
	component = mount(InlineEmailPrompt, {
		target: document.body,
		props: { defaultEmail: 'ada@example.com', onSubmitEmail }
	});
	flushSync();
	const input = document.querySelector<HTMLInputElement>('input[type="email"]')!;
	return { input, onSubmitEmail };
}

function pressEnter(input: HTMLInputElement, init: KeyboardEventInit = {}) {
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }));
	flushSync();
}

describe('InlineEmailPrompt', () => {
	it('does not subscribe on the Enter that confirms an IME candidate', () => {
		const { input, onSubmitEmail } = renderPrompt();
		pressEnter(input, { isComposing: true });
		// Safari reports that keydown after compositionend, with keyCode 229 only.
		pressEnter(input, { keyCode: 229 });
		expect(onSubmitEmail).not.toHaveBeenCalled();
	});

	it('subscribes once on an ordinary Enter', () => {
		const { input, onSubmitEmail } = renderPrompt();
		pressEnter(input);
		expect(onSubmitEmail).toHaveBeenCalledExactlyOnceWith('ada@example.com');
	});
});
