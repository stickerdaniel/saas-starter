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

function buttonClasses(props: ScrollButtonProps) {
	return (renderButton(props).getAttribute('class') ?? '').split(' ');
}

// Width, height and padding classes decide the rendered box of this icon-only button.
const geometry = (classes: string[]) =>
	classes.filter((name) => /^(size|h|w|p[xy]?|gap)-/.test(name));

describe('ScrollButton', () => {
	it.each([undefined, 'icon-sm', 'sm'] as const)('stays a 40px circle for size %s', (size) => {
		const classes = buttonClasses({ isAtBottom: false, size });

		expect(geometry(classes)).toEqual(['size-10']);
		expect(classes).toContain('rounded-full');
		expect(classes).toEqual(buttonClasses({ isAtBottom: false }));
	});

	// Callers sit inside a pointer-events-none overlay and used to pass pointer-events-auto,
	// which left the transparent hidden button clickable, focusable and announced.
	it('keeps the hidden button out of reach even when the caller enables pointer events', () => {
		const button = renderButton({ isAtBottom: true, class: 'pointer-events-auto' });
		const classes = (button.getAttribute('class') ?? '').split(' ');

		expect(button.hasAttribute('inert')).toBe(true);
		expect(classes).toContain('pointer-events-none');
		expect(classes).not.toContain('pointer-events-auto');
	});

	it('receives pointer events and focus while visible', () => {
		const button = renderButton({ isAtBottom: false });
		const classes = (button.getAttribute('class') ?? '').split(' ');

		expect(button.hasAttribute('inert')).toBe(false);
		expect(classes).toContain('pointer-events-auto');
		expect(classes).not.toContain('pointer-events-none');
	});
});
