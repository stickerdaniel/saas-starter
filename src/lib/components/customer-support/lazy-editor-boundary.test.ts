/**
 * The screenshot editor is imported on demand. An await block with no catch
 * rethrows a rejected import (svelte/src/internal/client/dom/blocks/await.js
 * "Rethrow the error if no catch block exists"), which takes the page down
 * rather than the overlay.
 *
 * That was unreachable while a failed chunk load always won its race with the
 * reload in app.html. It stopped being unreachable once an upload in progress
 * could hold that reload back for confirmation, so the import needs a boundary.
 *
 * Asserted structurally rather than through the browser: reaching the camera
 * means opening the widget, then a thread, then an overflow menu, and none of
 * that is what breaks. What breaks is someone removing the boundary.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	path.resolve('src/lib/components/customer-support/customer-support.svelte'),
	'utf8'
);

describe('lazy screenshot editor', () => {
	it('loads inside an error boundary', () => {
		const boundaryStart = source.indexOf('<svelte:boundary');
		const boundaryEnd = source.indexOf('</svelte:boundary>');
		const lazyImport = source.indexOf(
			"{#await import('./screenshot-editor/ScreenshotEditor.svelte')"
		);

		expect(lazyImport, 'the lazy import moved or was renamed').toBeGreaterThan(-1);
		expect(boundaryStart, 'no <svelte:boundary> around the lazy import').toBeGreaterThan(-1);
		expect(boundaryStart).toBeLessThan(lazyImport);
		expect(boundaryEnd).toBeGreaterThan(lazyImport);
	});

	it('routes a failure to the existing capture-error path', () => {
		// Not a bare boundary: the overlay has to come down and offer a way on,
		// which is what a failed capture already does.
		expect(source).toMatch(/<svelte:boundary\s+onerror=\{handleScreenshotCaptureError\}/);
	});
});
