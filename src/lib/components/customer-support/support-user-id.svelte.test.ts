import { afterEach, describe, expect, it, vi } from 'vitest';

// Runed binds to window storage only in a browser build.
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true, NODE: false }));

/** Loads the module as a fresh page would, reading whatever storage holds now. */
async function loadPage() {
	vi.resetModules();
	return import('./support-user-id.svelte.ts');
}

describe('clearSupportUserId', () => {
	afterEach(() => {
		localStorage.clear();
	});

	it('forgets an id the page loaded with, in this page and the next', async () => {
		localStorage.setItem('supportUserId', JSON.stringify('anon_migrated'));
		const page = await loadPage();
		expect(page.supportUserId.current).toBe('anon_migrated');

		page.clearSupportUserId();

		expect(page.supportUserId.current).toBeNull();
		expect((await loadPage()).supportUserId.current).toBeNull();
	});
});
