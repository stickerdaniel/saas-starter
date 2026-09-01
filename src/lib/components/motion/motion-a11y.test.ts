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

/** Where the plain label sits relative to the element that paints it. */
function labelBefore(template: string, paintedClass: string): boolean {
	const label = template.indexOf('class="sr-only"');
	const painted = template.indexOf(`cn('${paintedClass}'`);
	return label !== -1 && painted !== -1 && label < painted;
}

describe('shimmer text', () => {
	const template = markup('shimmer-text.svelte');

	it('hides the painted copy and keeps one plain label', () => {
		expect(template).toMatch(/<span class="sr-only">\{text\}<\/span>/);
		expect(template).toMatch(/class=\{cn\('t-shimmer'[^}]*\}[^>]*aria-hidden="true"/s);
	});

	it('keeps the label out of the hidden subtree', () => {
		expect(labelBefore(template, 't-shimmer')).toBe(true);
	});
});

describe('thinking states', () => {
	const template = markup('thinking-states.svelte');

	it('carries one live label and no status role', () => {
		expect(template).toMatch(/<span class="sr-only" aria-live="polite">\{text\}<\/span>/);
		// `role="status"` would be the obvious choice and is the wrong one: the
		// status line is the whole content of its consumer's accordion trigger,
		// and a `status` child does not contribute to name-from-content, so the
		// trigger loses its accessible name. Measured in Chromium on the real
		// component: named with the plain live node, unnamed with the role.
		expect(template).not.toMatch(/role="status"/);
	});

	it('hides the stack that holds both labels during a swap', () => {
		expect(template).toMatch(/class=\{cn\('t-think'[^}]*\}[^>]*aria-hidden="true"/s);
		// The sizer is inside the hidden stack, so it needs no hiding of its own.
		expect(template).toMatch(/class="t-think-sizer"(?![^>]*aria-hidden)/);
	});

	it('keeps the label out of the hidden subtree', () => {
		expect(labelBefore(template, 't-think')).toBe(true);
	});
});

describe('motion attachments', () => {
	const thinking = readFileSync(join(dir, 'thinking-states.svelte'), 'utf8');
	const avatar = readFileSync(join(dir, 'avatar-group-hover.svelte.ts'), 'utf8');
	const overview = readFileSync(join(dir, '../customer-support/threads-overview.svelte'), 'utf8');

	it('owns the thinking entrance through an attachment cleanup', () => {
		expect(thinking).toContain('Attachment<HTMLElement>');
		expect(thinking).toContain('{@attach enter(line.entering)}');
		expect(thinking).not.toContain('use:enter');
	});

	it('attaches the avatar lifecycle instead of using a legacy action', () => {
		expect(avatar).toContain('Attachment<HTMLElement>');
		expect(overview).toContain('{@attach avatarGroupHover}');
		expect(overview).not.toContain('use:avatarGroupHover');
	});
});
