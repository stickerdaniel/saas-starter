/**
 * Unit tests for the in-flight upload registry and the navigation predicate.
 *
 * Two failure modes matter more than the happy path: a stale claim makes the
 * app prompt forever for an upload that finished, and a predicate that answers
 * "block" for ordinary navigation makes the app feel broken.
 */

import { describe, it, expect } from 'vitest';
import {
	ActiveUploads,
	deployReloadTarget,
	shouldBlockNavigation
} from './active-uploads.svelte.ts';
import { installDeployRecoveryShell } from './__tests__/deploy-recovery-shell.ts';

function nav(from: string | null, to: string | null) {
	return {
		from: from === null ? null : { url: new URL(from, 'https://example.test') },
		to: to === null ? null : { url: new URL(to, 'https://example.test') }
	};
}

describe('ActiveUploads', () => {
	it('reports nothing in flight until a surface claims', () => {
		const uploads = new ActiveUploads();
		expect(uploads.any).toBe(false);
	});

	it('survives a doubled claim and a doubled release', () => {
		const uploads = new ActiveUploads();
		const owner = {};

		uploads.claim(owner);
		uploads.claim(owner);
		expect(uploads.any).toBe(true);

		uploads.release(owner);
		uploads.release(owner);
		expect(uploads.any).toBe(false);
	});

	it('keeps reporting in flight while a second surface still uploads', () => {
		const uploads = new ActiveUploads();
		const pageChat = {};
		const supportChat = {};

		uploads.claim(pageChat);
		uploads.claim(supportChat);
		uploads.release(pageChat);

		expect(uploads.any).toBe(true);
		uploads.release(supportChat);
		expect(uploads.any).toBe(false);
	});

	it('releasing a surface that never claimed leaves the others alone', () => {
		const uploads = new ActiveUploads();
		const uploading = {};

		uploads.claim(uploading);
		uploads.release({});

		expect(uploads.any).toBe(true);
	});

	it('spends a suspension on the very next navigation', () => {
		const uploads = new ActiveUploads();

		uploads.suspendOnce();
		expect(uploads.consumeSuspension()).toBe(true);
		expect(uploads.consumeSuspension()).toBe(false);
	});

	it('counts stopped in-app navigations so the UI can explain them', () => {
		const uploads = new ActiveUploads();

		expect(uploads.blockedCount).toBe(0);
		uploads.noteBlocked();
		uploads.noteBlocked();
		expect(uploads.blockedCount).toBe(2);
	});
});

describe('shouldBlockNavigation', () => {
	it('never blocks while nothing is uploading', () => {
		expect(shouldBlockNavigation(nav('/app/ai-chat', '/app/settings'), false)).toBe(false);
		expect(shouldBlockNavigation(nav('/app/ai-chat', null), false)).toBe(false);
	});

	it('blocks leaving the document, where `to` is absent', () => {
		// Reload, tab close and external links all arrive without a target.
		expect(shouldBlockNavigation(nav('/app/ai-chat', null), true)).toBe(true);
	});

	it('blocks moving to another page', () => {
		expect(shouldBlockNavigation(nav('/app/ai-chat', '/app/settings'), true)).toBe(true);
	});

	it('allows a search-param change on the same page', () => {
		// Opening the support panel and switching a chat thread both look like this.
		expect(shouldBlockNavigation(nav('/app/ai-chat?thread=a', '/app/ai-chat?thread=b'), true)).toBe(
			false
		);
	});

	it('blocks a first navigation that has no origin', () => {
		expect(shouldBlockNavigation(nav(null, '/app/settings'), true)).toBe(true);
	});
});

describe('deployReloadTarget', () => {
	const target = nav('/app/ai-chat?thread=a', '/app/ai-chat?thread=b');

	it('reloads on the next navigation once a deploy is detected', () => {
		expect(deployReloadTarget(target, true, false)?.pathname).toBe('/app/ai-chat');
	});

	it('stays put while nothing has been deployed', () => {
		expect(deployReloadTarget(target, false, false)).toBeNull();
	});

	it('waits while a file is transferring', () => {
		// The navigation itself is allowed through, because a search-param change
		// keeps the document. Turning it into a full load would not, and SvelteKit
		// runs no callback during a navigation, so nothing would ask first.
		expect(shouldBlockNavigation(target, true)).toBe(false);
		expect(deployReloadTarget(target, true, true)).toBeNull();
	});

	it('leaves a departure alone, since the document is going anyway', () => {
		expect(deployReloadTarget({ ...nav('/app', null), willUnload: true }, true, false)).toBeNull();
	});
});

/**
 * The app.html recovery script with the root registry attached, as on a page.
 *
 * Reloading under a running upload loses the file, and a reload the user
 * declines used to spend the tab's only attempt. These pin the wait, the single
 * retry, and that ordinary deploy navigation stays out of that budget.
 */
describe('deploy recovery held by uploads', () => {
	function attachedPage() {
		const shell = installDeployRecoveryShell();
		const uploads = new ActiveUploads();
		// A legacy shell must fail on its unwanted reload, not a missing bridge during setup.
		const detach = shell.window.__deployRecovery
			? uploads.holdRecovery(shell.window.__deployRecovery)
			: () => {};
		return { shell, uploads, detach };
	}

	it('reloads once for a failed preload before the app has attached', () => {
		// A stale entry chunk fails before hydration, so nothing can attach first.
		const shell = installDeployRecoveryShell();

		shell.preloadError();
		expect(shell.reloads).toBe(1);
		expect(shell.attempt).toBe('1');

		// A shell that is itself stale must not loop.
		shell.preloadError();
		expect(shell.reloads).toBe(1);
	});

	it('waits for the last of two uploads, then retries exactly once', () => {
		const { shell, uploads } = attachedPage();
		const pageChat = {};
		const avatar = {};
		uploads.claim(pageChat);
		uploads.claim(avatar);

		shell.preloadError();
		shell.preloadError();
		shell.preloadError();
		expect(shell.reloads).toBe(0);
		expect(shell.attempt).toBeNull();
		expect(uploads.recoveryPending).toBe(true);

		uploads.release(pageChat);
		expect(shell.reloads).toBe(0);
		expect(uploads.recoveryPending).toBe(true);

		uploads.release(avatar);
		expect(shell.reloads).toBe(1);
		expect(shell.attempt).toBe('1');
		expect(uploads.recoveryPending).toBe(false);

		uploads.claim(pageChat);
		uploads.release(pageChat);
		expect(shell.reloads).toBe(1);
	});

	it('keeps waiting for a transfer claimed while the reload was held', () => {
		const { shell, uploads } = attachedPage();
		const first = {};
		const second = {};
		uploads.claim(first);
		shell.preloadError();

		uploads.claim(second);
		uploads.release(first);
		expect(shell.reloads).toBe(0);

		uploads.release(second);
		expect(shell.reloads).toBe(1);
	});

	it('leaves the preload event to Vite, held or not', () => {
		// Vite rethrows the failed import to its caller only for an unprevented event.
		const { shell, uploads } = attachedPage();
		uploads.claim({});
		expect(shell.preloadError().defaultPrevented).toBe(false);

		const idle = installDeployRecoveryShell();
		expect(idle.preloadError().defaultPrevented).toBe(false);
	});

	it('does nothing when uploads settle without a failed preload', () => {
		const { shell, uploads } = attachedPage();
		const owner = {};
		uploads.claim(owner);
		uploads.release(owner);

		expect(shell.reloads).toBe(0);
		expect(shell.departures).toEqual([]);
	});

	it('keeps the preload attempt through ordinary deploy navigations', () => {
		const { shell } = attachedPage();

		expect(shell.recovery.navigate('https://example.test/app/settings')).toBe(true);
		expect(shell.recovery.navigate('https://example.test/app/ai-chat')).toBe(true);
		expect(shell.departures).toEqual([
			'https://example.test/app/settings',
			'https://example.test/app/ai-chat'
		]);
		expect(shell.attempt).toBeNull();

		shell.preloadError();
		expect(shell.reloads).toBe(1);
	});

	it('still navigates after a deploy once the preload attempt is spent', () => {
		const { shell, uploads } = attachedPage();
		shell.spendAttempt();

		shell.preloadError();
		expect(shell.reloads).toBe(0);
		expect(uploads.recoveryPending).toBe(false);

		expect(shell.recovery.navigate('https://example.test/app/settings')).toBe(true);
		expect(shell.departures).toEqual(['https://example.test/app/settings']);
	});

	it('does not queue a deploy navigation refused for an upload', () => {
		const { shell, uploads } = attachedPage();
		const owner = {};
		uploads.claim(owner);

		expect(shell.recovery.navigate('https://example.test/app/settings')).toBe(false);
		uploads.release(owner);

		expect(shell.departures).toEqual([]);
		expect(shell.reloads).toBe(0);
	});

	it('stops holding once the registry detaches', () => {
		const { shell, uploads, detach } = attachedPage();
		uploads.claim({});
		shell.preloadError();
		expect(uploads.recoveryPending).toBe(true);

		detach();
		expect(uploads.recoveryPending).toBe(false);
		shell.preloadError();
		expect(shell.reloads).toBe(1);
	});
});
