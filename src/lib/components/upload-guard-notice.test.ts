import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#lib/theme.svelte.ts', () => ({ mode: { current: 'light' } }));
vi.mock('@tolgee/svelte', async () => {
	const { readable } = await import('svelte/store');
	return { getTranslate: () => ({ t: readable((key: string) => key) }) };
});

import { toast } from 'svelte-sonner';
import { ActiveUploads } from '#lib/hooks/active-uploads.svelte.ts';
import UploadGuardNoticeHarness from './test-fixtures/UploadGuardNoticeHarness.svelte';

let component: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	toast.dismiss();
	flushSync();
	if (component) await unmount(component);
	component = undefined;
	vi.doUnmock('./ui/sonner/sonner.svelte');
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

function renderWithUpload(): ActiveUploads {
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
	);
	const uploads = new ActiveUploads();
	uploads.claim({});
	component = mount(UploadGuardNoticeHarness, { target: document.body, props: { uploads } });
	flushSync();
	return uploads;
}

async function settle(): Promise<void> {
	for (let round = 0; round < 10; round++) {
		await vi.dynamicImportSettled();
		await tick();
		flushSync();
	}
}

function reloadButton(): HTMLButtonElement | undefined {
	return [...document.querySelectorAll('button')].find(
		(button) => button.textContent?.trim() === 'common.reload'
	);
}

describe('UploadGuardNotice', () => {
	it('offers the held reload in a toast when the toaster loads', async () => {
		const uploads = renderWithUpload();

		uploads.holdDeployReload();
		flushSync();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-sonner-toast]')?.textContent).toContain(
				'common.update_available'
			)
		);
		expect(document.querySelector('[data-testid="toast-fallback"]')).toBeNull();
		expect(reloadButton()).toBeDefined();
	});

	it('offers the held reload without the toaster when its chunk is gone', async () => {
		const uploads = renderWithUpload();
		let attempts = 0;
		vi.doMock('./ui/sonner/sonner.svelte', () => {
			attempts += 1;
			// app.html holds the reload for the failed chunk while the upload runs.
			uploads.holdDeployReload();
			throw new Error('Failed to fetch dynamically imported module');
		});

		uploads.holdDeployReload();
		flushSync();
		await settle();

		const fallback = document.querySelector('[data-testid="toast-fallback"]');
		expect(fallback?.textContent).toContain('common.update_available');
		expect(reloadButton()).toBeDefined();
		expect(attempts).toBe(1);

		uploads.holdDeployReload();
		flushSync();
		await settle();
		expect(attempts).toBe(1);

		vi.doUnmock('./ui/sonner/sonner.svelte');
		toast('Avatar uploaded');
		flushSync();
		await vi.waitFor(() =>
			expect(document.querySelector('[data-sonner-toaster]')?.textContent).toContain(
				'common.update_available'
			)
		);
		expect(document.querySelector('[data-testid="toast-fallback"]')).toBeNull();
	});

	it('explains a blocked navigation without the toaster when its chunk is gone', async () => {
		const uploads = renderWithUpload();
		vi.doMock('./ui/sonner/sonner.svelte', () => {
			throw new Error('Failed to fetch dynamically imported module');
		});

		uploads.noteBlocked();
		flushSync();
		await settle();

		const fallback = document.querySelector('[data-testid="toast-fallback"]');
		expect(fallback?.textContent).toContain('common.upload_in_progress');
		expect(reloadButton()).toBeUndefined();
	});
});
