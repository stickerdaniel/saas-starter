import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { computeAccessibleName } from 'dom-accessibility-api';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);

import MarkdownHost from './test-fixtures/MarkdownHost.svelte';

let component: ReturnType<typeof mount> | undefined;

async function show(content: string) {
	component = mount(MarkdownHost, { target: document.body, props: { content } });
	flushSync();
	await vi.waitFor(() => expect(document.querySelector('.typeset > *')).not.toBeNull());
}

const names = (role: string) =>
	[...document.querySelectorAll(`[role="${role}"]`)].map((element) =>
		computeAccessibleName(element)
	);

const links = () =>
	[...document.querySelectorAll('a')].map((link) => ({
		name: computeAccessibleName(link),
		href: link.getAttribute('href')
	}));

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('the docs Markdown', () => {
	it.each([
		['a link', '- [ ] Read [the code page](/en/docs/reference/code)', ['Read the code page']],
		['emphasis', '- [ ] **Bold task** with _more_ text', ['Bold task with more text']],
		['inline code', '- [x] Run `bun run build` first', ['Run bun run build first']],
		['an image', '- [ ] Compare ![the logo](/logo.svg) here', ['Compare the logo here']],
		[
			'a nested task',
			'- [ ] Outer task\n  - [x] Nested [the API](/en/docs/reference/code)',
			['Outer task', 'Nested the API']
		],
		[
			'a quote',
			'> - [ ] Quoted [documentation](/en/docs/reference/code)',
			['Quoted documentation']
		],
		['a second block', '- [ ] First block\n\n  A second block.', ['First block']],
		['a hard line break', '- [ ] First  \n  Second', ['First Second']],
		['literal HTML', '- [ ] Go <em>italic</em> &amp; more', ['Go <em>italic</em> &amp; more']]
	])('names a task checkbox with %s by the text a reader sees', async (_, content, expected) => {
		await show(content);
		expect(names('checkbox')).toEqual(expected);
	});

	it('names the permalink beside a heading that holds a link by its heading', async () => {
		await show(
			'## [Only a link](/en/docs#alerts)\n\n### A _stressed_ `code` [link](/en/docs#alerts)\n\n## A plain heading'
		);
		expect(links()).toEqual([
			{ name: 'Only a link', href: '/en/docs#alerts' },
			{ name: 'Link to section Only a link', href: '#only-a-link' },
			{ name: 'link', href: '/en/docs#alerts' },
			{ name: 'Link to section A stressed code link', href: '#a-stressed-code-link' },
			{ name: 'A plain heading', href: '#a-plain-heading' }
		]);
		expect(document.querySelectorAll('a a')).toHaveLength(0);
	});

	it('puts the permalink beside a heading that holds an image and names it by the alt text', async () => {
		await show(
			'## ![Deploy button](https://example.com/deploy.svg)\n\n## Deploy ![badge](https://example.com/badge.svg) now\n\n## _![Stressed mark](https://example.com/mark.svg)_'
		);
		expect(links()).toEqual([
			{ name: 'Link to section Deploy button', href: '#deploy-button' },
			{ name: 'Link to section Deploy badge now', href: '#deploy--now' },
			{ name: 'Link to section Stressed mark', href: '#stressed-mark' }
		]);
		expect([...document.querySelectorAll('h2')].map((heading) => heading.id)).toEqual([
			'deploy-button',
			'deploy--now',
			'stressed-mark'
		]);
		expect(document.querySelectorAll('a img')).toHaveLength(0);
	});
});
