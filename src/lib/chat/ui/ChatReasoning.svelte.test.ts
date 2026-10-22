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

/** The trigger's accessible name, resolved through its `aria-labelledby` reference. */
function triggerName(trigger: Element | null): string | undefined {
	const id = trigger?.getAttribute('aria-labelledby');
	return id ? document.getElementById(id)?.textContent?.trim() : undefined;
}

describe('reasoning line', () => {
	// A live region announces changes to a node already in the page, so every label from
	// connecting to done has to land in one node that outlives the switch from plain line
	// to trigger. The painted copy stays hidden, so the label is exposed once and names
	// the trigger. A `role="status"` node would not contribute its text to that name.
	it('announces connecting, thinking and done from one live node that names the trigger', () => {
		const props = $state({ hasContent: false, isStreaming: true, content: '' });
		component = mount(ChatReasoning, { target: document.body, props });
		flushSync();
		const announcer = liveNode();
		expect(announcer.textContent).toBe('chat.reasoning.connecting');
		expect(exposedText(document.body)).toEqual(['chat.reasoning.connecting']);
		expect(document.querySelector('[role="status"]')).toBeNull();

		props.hasContent = true;
		props.content = 'Looking up';
		flushSync();
		const trigger = document.querySelector('button[aria-expanded]');
		expect(liveNode()).toBe(announcer);
		expect(announcer.textContent).toBe('chat.reasoning.thinking');
		expect(triggerName(trigger)).toBe('chat.reasoning.thinking');
		expect(trigger && exposedText(trigger)).toEqual([]);

		props.isStreaming = false;
		flushSync();
		expect(liveNode()).toBe(announcer);
		expect(announcer.textContent).toBe('chat.reasoning.thought_for_few_seconds');
		expect(triggerName(trigger)).toBe('chat.reasoning.thought_for_few_seconds');
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
