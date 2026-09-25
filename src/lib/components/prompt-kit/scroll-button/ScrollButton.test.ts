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

function buttonClasses(props: ScrollButtonProps) {
	const host = new JSDOM(render(ScrollButton, { props }).body).window.document;
	return (host.querySelector('[data-slot="button"]')?.getAttribute('class') ?? '').split(' ');
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
});
