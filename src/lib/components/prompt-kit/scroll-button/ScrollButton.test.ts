// @vitest-environment node
import { createRequire } from 'node:module';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import ScrollButton, { type ScrollButtonProps } from './ScrollButton.svelte';

vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document } };
};

function renderButton(props: ScrollButtonProps) {
	const host = new JSDOM(render(ScrollButton, { props }).body).window.document;
	const button = host.querySelector('[data-slot="button"]');
	if (!button) throw new Error('ScrollButton rendered no button');
	return button;
}

describe('ScrollButton', () => {
	// The size prop stays in the public type for compatibility and must not change the button.
	it.each(['icon-sm', 'sm'] as const)('renders the same button for size %s', (size) => {
		expect(renderButton({ isAtBottom: false, size }).outerHTML).toBe(
			renderButton({ isAtBottom: false }).outerHTML
		);
	});

	// The faded-out button sits over the last message; it must leave the tab order and the
	// accessibility tree, not only turn transparent.
	it('is inert only while hidden', () => {
		expect(renderButton({ isAtBottom: true }).hasAttribute('inert')).toBe(true);
		expect(renderButton({ isAtBottom: false }).hasAttribute('inert')).toBe(false);
	});
});
