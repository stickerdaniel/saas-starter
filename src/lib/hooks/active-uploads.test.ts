/**
 * Unit tests for the in-flight upload registry, the navigation predicate and
 * the app shell's deploy recovery that consults the registry.
 *
 * Two failure modes matter more than the happy path: a stale claim makes the
 * app prompt forever for an upload that finished, and a predicate that answers
 * "block" for ordinary navigation makes the app feel broken.
 */

import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import appTemplate from '../../app.html?raw';
import {
	ActiveUploads,
	deployReloadTarget,
	shouldBlockNavigation
} from './active-uploads.svelte.ts';

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
 * The deploy-recovery script exactly as src/app.html ships it, run before any
 * app code like the browser does. jsdom cannot reload, so the stand-in
 * location records the request instead.
 */
function appShell() {
	const scripts = new DOMParser().parseFromString(appTemplate, 'text/html').scripts;
	const script = [...scripts]
		.map((element) => element.textContent)
		.find((body) => body.includes('vite:preloadError'));
	if (!script) throw new Error('src/app.html lost its deploy-recovery script');

	const window = new EventTarget() as EventTarget & Partial<Pick<Window, '__deployRecovery'>>;
	const session = new Map<string, string>();
	const reload = vi.fn();
	runInNewContext(script, {
		window,
		sessionStorage: {
			getItem: (key: string) => session.get(key) ?? null,
			setItem: (key: string, value: string) => session.set(key, value)
		},
		location: { reload }
	});

	return {
		recovery: window.__deployRecovery!,
		reload,
		attempt: () => session.get('sk:preload-reloaded') ?? null,
		/** What Vite dispatches when a chunk import fails. */
		failImport() {
			const event = new Event('vite:preloadError', { cancelable: true });
			window.dispatchEvent(event);
			return event;
		}
	};
}

describe('deploy recovery after a failed chunk import', () => {
	it('keeps the page and its one reload while a file is in flight', () => {
		const shell = appShell();
		const uploads = new ActiveUploads();
		shell.recovery.hold(() => uploads.holdDeployReload());
		const upload = {};
		uploads.claim(upload);

		const failure = shell.failImport();
		// Vite hands the failed import to its caller only while nothing prevents this.
		expect(failure.defaultPrevented).toBe(false);
		expect(shell.reload).not.toHaveBeenCalled();
		expect(shell.attempt()).toBeNull();
		expect(uploads.heldReloadCount).toBe(1);

		// Finishing the upload alone leaves the page: a finished upload can still
		// hold unsaved work.
		uploads.release(upload);
		expect(shell.reload).not.toHaveBeenCalled();

		shell.failImport();
		expect(shell.reload).toHaveBeenCalledOnce();
		expect(shell.attempt()).toBe('1');

		// The stale shell itself must not loop.
		shell.failImport();
		expect(shell.reload).toHaveBeenCalledOnce();
	});

	it('reloads right away while nothing is in flight', () => {
		const shell = appShell();
		const uploads = new ActiveUploads();
		shell.recovery.hold(() => uploads.holdDeployReload());

		shell.failImport();
		expect(shell.reload).toHaveBeenCalledOnce();
		expect(uploads.heldReloadCount).toBe(0);
	});
});
