import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

import ShimmerText from './shimmer-text.svelte';
import ThinkingStates from './thinking-states.svelte';

/**
 * Both components paint their label more than once: the status line keeps the
 * outgoing and incoming copies in the DOM together for the length of a swap, and
 * the shimmer repeats the string through a `::before` that clips the moving
 * highlight. Chromium exposes generated content, so before the announced text
 * was split from the painted text, one shimmering "Thinking" read as
 * "Thinking Thinking" and a swap read as "Connecting Thinking".
 *
 * The mounted cases observe that split in the DOM: the painted copies sit under
 * `aria-hidden`, and the current label reaches assistive technology from exactly
 * one other node. jsdom builds no accessibility tree and paints no generated
 * content, so the consumer trigger's accessible name was measured in Chromium
 * only; the source case below holds the markup that measurement depends on.
 */

const dir = import.meta.dirname;

function markup(file: string): string {
	const source = readFileSync(join(dir, file), 'utf8');
	let template = source.slice(source.lastIndexOf('</script>'));
	// Repeat until stable so a comment split around another one cannot survive.
	for (let previous = ''; previous !== template;) {
		previous = template;
		template = template.replace(/<!--[\s\S]*?-->/g, '');
	}
	return template;
}

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

let component: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('shimmer text', () => {
	it('exposes its label once and hides the painted copy', () => {
		component = mount(ShimmerText, { target: document.body, props: { text: 'Thinking' } });
		flushSync();

		expect(exposedText(document.body)).toEqual(['Thinking']);
	});
});

describe('thinking states', () => {
	const template = markup('thinking-states.svelte');

	it('announces only the latest label while the painted lines swap', () => {
		const props = $state({ text: 'Connecting' });
		component = mount(ThinkingStates, { target: document.body, props });
		flushSync();
		const live = () => document.querySelector('[aria-live="polite"]')?.textContent;

		for (const text of ['Thinking', 'Thought for 4 seconds']) {
			props.text = text;
			flushSync();
			expect(live()).toBe(text);
			expect(exposedText(document.body)).toEqual([text]);
		}
	});

	it('carries one live label and no status role', () => {
		expect(template).toMatch(/<span class="sr-only" aria-live="polite">\{text\}<\/span>/);
		// `role="status"` would be the obvious choice and is the wrong one: the
		// status line is the whole content of its consumer's accordion trigger,
		// and a `status` child does not contribute to name-from-content, so the
		// trigger loses its accessible name. Measured in Chromium on the real
		// component: named with the plain live node, unnamed with the role.
		expect(template).not.toMatch(/role="status"/);
	});
});

describe('motion attachments', () => {
	const avatar = readFileSync(join(dir, 'avatar-group-hover.svelte.ts'), 'utf8');
	const overview = readFileSync(join(dir, '../customer-support/threads-overview.svelte'), 'utf8');

	it('attaches and tears down the avatar lifecycle', () => {
		expect(avatar).toContain('Attachment<HTMLElement>');
		expect(avatar).toContain("hoverCapable.removeEventListener('change', syncCapability);");
		expect(avatar).toContain('observer?.disconnect();');
		expect(avatar).toContain('disable();');
		expect(overview).toContain('{@attach avatarGroupHover}');
		expect(overview).not.toContain('use:avatarGroupHover');
	});
});
