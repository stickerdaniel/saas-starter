// @vitest-environment node

/**
 * The desk computer as the server renders it. Agents read this HTML without running
 * scripts, so the figure's markup stays out of it; a linked stylesheet paints the figure.
 */

import { render } from 'svelte/server';
import { expect, it, vi } from 'vitest';

// Vitest skips CSS processing, which leaves a `?url` stylesheet address empty.
vi.mock('virtual:desk-computer-frame.css?url', () => ({ default: '/frame.css' }));

import DeskComputer from './DeskComputer.svelte';

it('links the stylesheet frame and leaves the figure markup out of the HTML', () => {
	const { head, body } = render(DeskComputer);

	expect(body).not.toContain('<svg');
	expect(head).toContain('<link rel="stylesheet" href="/frame.css"/>');
});
