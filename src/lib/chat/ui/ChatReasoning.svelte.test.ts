import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import ChatReasoning from './ChatReasoning.svelte';

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

beforeEach(() => {
	// jsdom has no matchMedia; the markdown renderer reads the color scheme.
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
});

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

/** Rendered text outside every `aria-hidden` subtree, in document order. */
function exposedText(root: Element): string[] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const texts: string[] = [];
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.textContent?.trim();
		if (text && !node.parentElement?.closest('[aria-hidden="true"]')) texts.push(text);
	}
	return texts;
}

/** The one polite live node; none or several fail the test. */
function liveNode(): Element {
	const live = document.querySelectorAll('[aria-live="polite"]');
	expect(live).toHaveLength(1);
	return live[0]!;
}

describe('reasoning line', () => {
	// The line's text is the trigger's accessible name, so it must carry exactly the
	// current label once: the painted copy is hidden and the exposed one is the live node
	// that announces each change. A `role="status"` would drop it from the trigger's name.
	it('exposes and announces exactly the current label from connecting through thinking to done', () => {
		const props = $state({ hasContent: false, isStreaming: true, content: '' });
		component = mount(ChatReasoning, { target: document.body, props });
		flushSync();
		expect(exposedText(document.body)).toEqual(['chat.reasoning.connecting']);
		expect(liveNode().textContent).toBe('chat.reasoning.connecting');
		expect(document.querySelector('[role="status"]')).toBeNull();

		props.hasContent = true;
		props.content = 'Looking up';
		flushSync();
		const trigger = document.querySelector('button[aria-expanded]');
		expect(trigger && exposedText(trigger)).toEqual(['chat.reasoning.thinking']);
		// A live region announces changes to a node already in the page, so the next label
		// has to land in this same node.
		const announcer = liveNode();
		expect(trigger?.contains(announcer)).toBe(true);
		expect(announcer.textContent).toBe('chat.reasoning.thinking');

		props.isStreaming = false;
		flushSync();
		expect(trigger && exposedText(trigger)).toEqual(['chat.reasoning.thought_for_few_seconds']);
		expect(liveNode()).toBe(announcer);
		expect(announcer.textContent).toBe('chat.reasoning.thought_for_few_seconds');
	});

	it('opens with the caller-owned state once text arrives after connecting', () => {
		const props = $state({ open: true, hasContent: false, isStreaming: true, content: '' });
		component = mount(ChatReasoning, { target: document.body, props });
		flushSync();
		expect(document.querySelector('button[aria-expanded]')).toBeNull();

		props.hasContent = true;
		props.content = 'Looking up';
		flushSync();
		expect(document.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe(
			'true'
		);
	});

	it('reports the reader toggle without taking ownership of the open state', () => {
		const onOpenChange = vi.fn();
		component = mount(ChatReasoning, {
			target: document.body,
			props: { open: false, onOpenChange, hasContent: true, content: 'Done thinking' }
		});
		flushSync();
		document.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
		flushSync();
		expect(onOpenChange).toHaveBeenCalledWith(true);
	});
});
