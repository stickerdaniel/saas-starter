/**
 * Unit tests for the in-flight upload registry and the navigation predicate.
 *
 * Two failure modes matter more than the happy path: a stale claim makes the
 * app prompt forever for an upload that finished, and a predicate that answers
 * "block" for ordinary navigation makes the app feel broken.
 */

import { describe, it, expect } from 'vitest';
import { ActiveUploads, shouldBlockNavigation } from './active-uploads.svelte.ts';

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
