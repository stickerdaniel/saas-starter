/**
 * A held deploy reload is announced for exactly as long as it is held.
 *
 * The page reloads by itself once the upload lands; without a word that looks
 * like a crash, and a notice that outlives the wait promises a reload that is
 * not coming.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

vi.hoisted(() => {
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: (media: string) => ({
			matches: false,
			media,
			addEventListener() {},
			removeEventListener() {}
		})
	});
});

import { ActiveUploads } from '$lib/hooks/active-uploads.svelte.ts';
import { installDeployRecoveryShell } from '$lib/hooks/__tests__/deploy-recovery-shell.ts';
import UploadGuardNoticeHarness from './test-fixtures/UploadGuardNoticeHarness.svelte';
import en from '../../i18n/en.json';

const PENDING = en.common.reload_after_upload;
const BLOCKED = en.common.upload_in_progress;

let component: ReturnType<typeof mount> | undefined;

async function render() {
	const shell = installDeployRecoveryShell();
	const uploads = new ActiveUploads();
	uploads.holdRecovery(shell.recovery);
	component = mount(UploadGuardNoticeHarness, { target: document.body, props: { uploads } });
	await tick();
	return { shell, uploads, harness: component as { unmountNotice(): void } };
}

const shown = (text: string) => document.body.textContent?.includes(text) ?? false;

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('UploadGuardNotice', () => {
	it('announces a held reload until the upload settles', async () => {
		const { shell, uploads } = await render();
		const owner = {};
		uploads.claim(owner);
		shell.preloadError();

		await vi.waitFor(() => expect(shown(PENDING)).toBe(true));

		uploads.release(owner);
		flushSync();
		await vi.waitFor(() => expect(shown(PENDING)).toBe(false));
	});

	it('takes the announcement down with it', async () => {
		const { shell, uploads, harness } = await render();
		uploads.claim({});
		shell.preloadError();
		await vi.waitFor(() => expect(shown(PENDING)).toBe(true));

		harness.unmountNotice();
		flushSync();
		await vi.waitFor(() => expect(shown(PENDING)).toBe(false));
	});

	it('still explains a stopped navigation on its own', async () => {
		const { uploads } = await render();
		uploads.noteBlocked();

		await vi.waitFor(() => expect(shown(BLOCKED)).toBe(true));
		expect(shown(PENDING)).toBe(false);
	});
});
