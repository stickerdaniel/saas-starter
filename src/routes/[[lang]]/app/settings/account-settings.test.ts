/**
 * The profile picture upload holds deploy recovery from its first moment.
 *
 * A reload requested between picking the file and the next render used to find
 * nothing in flight, because the claim waited for an effect, and the transfer
 * died with the page.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import type * as Transfer from '$lib/uploads/transfer.js';
import type * as ProfileImage from '$lib/uploads/profile-image.js';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const transfer = vi.hoisted(() => ({
	requestUploadGrant: vi.fn(),
	uploadGrantedWithAdapter: vi.fn()
}));
vi.mock('$lib/uploads/transfer.js', async (importOriginal) => ({
	...(await importOriginal<typeof Transfer>()),
	...transfer
}));
vi.mock('$lib/uploads/profile-image.js', async (importOriginal) => ({
	...(await importOriginal<typeof ProfileImage>()),
	prepareProfileImage: async (file: File) => ({ ok: true, blob: file })
}));
vi.mock('convex-svelte', () => ({ useConvexClient: () => ({ mutation: vi.fn() }) }));
vi.mock('$lib/auth-client.js', () => ({ authClient: { updateUser: vi.fn() } }));
const haptic = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic }));

import { ActiveUploads } from '$lib/hooks/active-uploads.svelte.ts';
import { installDeployRecoveryShell } from '$lib/hooks/__tests__/deploy-recovery-shell.ts';
import AccountSettingsHarness from './test-fixtures/AccountSettingsHarness.svelte';

let component: ReturnType<typeof mount> | undefined;

/** One upload attempt whose provider answer the test decides. */
function attempt() {
	let grant!: (value: unknown) => void;
	let refuse!: (error: unknown) => void;
	transfer.requestUploadGrant.mockImplementationOnce(
		() =>
			new Promise((resolve, reject) => {
				grant = resolve;
				refuse = reject;
			})
	);
	return {
		succeed() {
			transfer.uploadGrantedWithAdapter.mockResolvedValueOnce({ value: 'https://cdn.test/me.png' });
			grant({ uploadUrl: 'https://upload.test', uploadToken: 'token' });
		},
		fail: () => refuse(new Error('network'))
	};
}

async function render() {
	const shell = installDeployRecoveryShell();
	const uploads = new ActiveUploads();
	uploads.holdRecovery(shell.recovery);
	component = mount(AccountSettingsHarness, { target: document.body, props: { uploads } });
	await tick();
	return { shell, uploads };
}

/** Pick a picture. Returns before Svelte has flushed anything the pick changed. */
function pickPicture() {
	const input = document.querySelector<HTMLInputElement>('#file-upload')!;
	const file = new File(['png'], 'me.png', { type: 'image/png' });
	// jsdom has no DataTransfer to build a FileList; the Input wrapper writes it back.
	Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [file] });
	input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
	transfer.requestUploadGrant.mockReset();
	transfer.uploadGrantedWithAdapter.mockReset();
	haptic.trigger.mockClear();
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('profile picture upload and deploy recovery', () => {
	it('holds a reload requested right after the pick, then reloads once it lands', async () => {
		const { shell, uploads } = await render();
		const upload = attempt();

		pickPicture();
		shell.preloadError();
		expect(shell.reloads).toBe(0);
		expect(shell.attempt).toBeNull();
		expect(uploads.recoveryPending).toBe(true);

		upload.succeed();
		await vi.waitFor(() => expect(shell.reloads).toBe(1));
		expect(uploads.any).toBe(false);
	});

	it('reloads once a failed upload has settled', async () => {
		const { shell, uploads } = await render();
		const upload = attempt();

		pickPicture();
		shell.preloadError();
		upload.fail();

		await vi.waitFor(() => expect(shell.reloads).toBe(1));
		expect(uploads.any).toBe(false);
	});

	it('lets go when the settings page is torn down mid-upload', async () => {
		const { shell, uploads } = await render();
		attempt();

		pickPicture();
		shell.preloadError();
		await unmount(component!);
		component = undefined;

		expect(uploads.any).toBe(false);
		expect(shell.reloads).toBe(1);
	});

	it('releases every overlapping attempt when the settings page is torn down', async () => {
		const { shell, uploads } = await render();
		attempt();
		attempt();

		pickPicture();
		pickPicture();
		shell.preloadError();
		await unmount(component!);
		component = undefined;

		expect(uploads.any).toBe(false);
		expect(shell.reloads).toBe(1);
	});

	it('does not let an earlier attempt settling late release a newer one', async () => {
		const { shell, uploads } = await render();
		const earlier = attempt();
		const newer = attempt();

		pickPicture();
		pickPicture();
		shell.preloadError();

		earlier.fail();
		// The failure feedback runs in the same continuation as the attempt's finally.
		await vi.waitFor(() => expect(haptic.trigger).toHaveBeenCalledWith('error'));
		expect(uploads.any).toBe(true);
		expect(shell.reloads).toBe(0);

		newer.fail();
		await vi.waitFor(() => expect(shell.reloads).toBe(1));
	});
});
