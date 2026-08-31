import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Both components paint their label more than once: the status line keeps the
 * outgoing and incoming copies in the DOM together for the length of a swap, and
 * the shimmer repeats the string through a `::before` that clips the moving
 * highlight. Chromium exposes generated content, so before the announced text
 * was split from the painted text, one shimmering "Thinking" read as
 * "Thinking Thinking" and a swap read as "Connecting Thinking".
 *
 * This asserts the markup contract rather than a render, because the suite's
 * jsdom project resolves Svelte's server build and cannot mount a component.
 * It holds the shape that fix depends on: the painted copy is hidden, and the
 * label reaches assistive technology from exactly one other node.
 */

const dir = import.meta.dirname;

function markup(file: string): string {
	const source = readFileSync(join(dir, file), 'utf8');
	return source.slice(source.lastIndexOf('</script>')).replace(/<!--[\s\S]*?-->/g, '');
}

describe('shimmer text', () => {
	const template = markup('shimmer-text.svelte');

	it('hides the painted copy and keeps one plain label', () => {
		expect(template).toMatch(/<span class="sr-only">\{text\}<\/span>/);
		expect(template).toMatch(/class=\{cn\('t-shimmer'[^}]*\}[^>]*aria-hidden="true"/s);
	});
});

describe('thinking states', () => {
	const template = markup('thinking-states.svelte');

	it('announces from one live region outside the painted stack', () => {
		const live = template.match(/role="status"/g) ?? [];
		expect(live).toHaveLength(1);
		expect(template).toMatch(
			/<span class="sr-only" role="status" aria-live="polite">\{text\}<\/span>/
		);
	});

	it('hides the stack that holds both labels during a swap', () => {
		expect(template).toMatch(/class=\{cn\('t-think'[^}]*\}[^>]*aria-hidden="true"/s);
		// The sizer is inside the hidden stack, so it needs no hiding of its own.
		expect(template).toMatch(/class="t-think-sizer"(?![^>]*aria-hidden)/);
	});
});
