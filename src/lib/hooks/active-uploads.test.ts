/**
 * Unit tests for the in-flight upload registry, the navigation predicate and
 * the app shell's deploy recovery that consults the registry.
 *
 * Two failure modes matter more than the happy path: a stale claim makes the
 * app prompt forever for an upload that finished, and a predicate that answers
 * "block" for ordinary navigation makes the app feel broken.
 */

import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import appTemplate from '../../app.html?raw';
import {
	ActiveUploads,
	deployReloadTarget,
	guardLinkClicksDuringNavigation,
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

describe('guardLinkClicksDuringNavigation', () => {
	const settings = new URL('/en/app/settings', location.origin);
	let navigating = true;
	let uploads: ActiveUploads;
	let stop: () => void;

	function guard() {
		stop = guardLinkClicksDuringNavigation(document, {
			navigating: () => navigating,
			currentUrl: () => settings,
			uploads
		});
	}

	beforeEach(() => {
		navigating = true;
		uploads = new ActiveUploads();
		uploads.claim({});
		guard();
	});

	afterEach(() => {
		stop();
		document.body.replaceChildren();
	});

	/**
	 * Clicks `target` inside `root`, which stands in for the app root where
	 * SvelteKit's router and Svelte's delegated handlers listen. `followed` is the
	 * router's answer: it skips a prevented click. `reached` is an app handler that
	 * acts on every click it receives, as a link whose own handler calls `goto` does.
	 */
	function dispatchIn(root: HTMLElement, target: Element, init: MouseEventInit = {}) {
		let followed = false;
		let reached = false;
		root.addEventListener('click', (event) => {
			reached = true;
			if (event.defaultPrevented) return;
			followed = true;
			// The router takes the navigation over; this also keeps jsdom from trying it.
			event.preventDefault();
		});
		target.dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...init })
		);
		return { followed, reached };
	}

	function appRoot() {
		const root = document.createElement('div');
		document.body.append(root);
		return root;
	}

	function link(href: string, attrs: Record<string, string> = {}) {
		const anchor = document.createElement('a');
		anchor.href = href;
		for (const [name, value] of Object.entries(attrs)) anchor.setAttribute(name, value);
		return anchor;
	}

	/** Clicks a plain link, or one placed inside a shadow root. */
	function click(
		href: string,
		init: MouseEventInit = {},
		attrs: Record<string, string> = {},
		inShadow = false
	) {
		const root = appRoot();
		const anchor = link(href, attrs);
		if (inShadow) {
			const host = document.createElement('div');
			root.append(host);
			host.attachShadow({ mode: 'open' }).append(anchor);
		} else {
			root.append(anchor);
		}
		return dispatchIn(root, anchor, init);
	}

	it('stops a link off the page while a navigation is under way and a file is going out', () => {
		expect(click('/en/app')).toEqual({ followed: false, reached: false });
		expect(uploads.blockedCount).toBe(1);
	});

	it('keeps the stopped click from app handlers that ignore defaultPrevented', () => {
		const { reached } = click('/en/app');
		expect(reached).toBe(false);
	});

	it('stops a link to another origin, which unloads the document', () => {
		expect(click('https://elsewhere.test/en/app/settings').followed).toBe(false);
	});

	it('stops a link inside a shadow root', () => {
		expect(click('/en/app', {}, {}, true).followed).toBe(false);
	});

	it('stops a link that wraps a shadow host, clicked inside its shadow root', () => {
		const root = appRoot();
		const anchor = link('/en/app');
		const host = document.createElement('span');
		const label = document.createElement('span');
		host.attachShadow({ mode: 'open' }).append(label);
		anchor.append(host);
		root.append(anchor);
		expect(dispatchIn(root, label).followed).toBe(false);
	});

	it('stops a shadow-root link whose slotted label is clicked', () => {
		const root = appRoot();
		const host = document.createElement('div');
		const slotted = document.createElement('span');
		host.append(slotted);
		const anchor = link('/en/app');
		anchor.append(document.createElement('slot'));
		host.attachShadow({ mode: 'open' }).append(anchor);
		root.append(host);
		expect(dispatchIn(root, slotted).followed).toBe(false);
	});

	it('stops a download link to another origin, which the browser follows', () => {
		expect(click('https://elsewhere.test/report.pdf', {}, { download: '' }).followed).toBe(false);
	});

	it('leaves the click to beforeNavigate when no navigation is under way', () => {
		navigating = false;
		expect(click('/en/app')).toEqual({ followed: true, reached: true });
		expect(uploads.blockedCount).toBe(0);
	});

	it('lets a link through once nothing is going out', () => {
		stop();
		uploads = new ActiveUploads();
		guard();
		expect(click('/en/app').followed).toBe(true);
	});

	it('lets a same-page link through, which keeps the document', () => {
		expect(click('/en/app/settings?tab=avatar').followed).toBe(true);
	});

	it('leaves new-tab, modified and same-origin download clicks to the browser', () => {
		expect(click('/en/app', {}, { target: '_blank' }).followed).toBe(true);
		expect(click('/en/app', { metaKey: true }).followed).toBe(true);
		expect(click('/en/app/export.csv', {}, { download: '' }).followed).toBe(true);
		expect(uploads.blockedCount).toBe(0);
	});
});
