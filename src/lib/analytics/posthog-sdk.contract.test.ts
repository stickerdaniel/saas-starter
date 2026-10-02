/**
 * Contract of the pinned posthog-js release that the consent integration relies on.
 * Real SDK, jsdom, network stubbed at the transport boundary. When a posthog-js
 * upgrade breaks one of these, the integration's guarantees need a fresh review.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	initAndWait,
	installNetworkRecorder,
	loadSdk,
	resetBrowserStores
} from './testing/sdk-harness';

const net = installNetworkRecorder();
const TOKEN = 'phc_contract';
const BASE = {
	api_host: 'https://eu.i.posthog.com',
	persistence: 'localStorage' as const,
	opt_out_capturing_by_default: true,
	opt_out_persistence_by_default: true,
	capture_pageview: false as const,
	capture_pageleave: false as const,
	autocapture: false,
	disable_session_recording: true,
	advanced_disable_flags: true,
	disable_external_dependency_loading: true,
	request_batching: false
};

beforeEach(() => {
	net.reset();
	resetBrowserStores();
	window.history.replaceState(null, '', '/');
});

afterEach(() => {
	resetBrowserStores();
});

describe('posthog-js consent contract', () => {
	it('captures and persists nothing before opt-in under rejecting defaults', async () => {
		const posthog = await initAndWait(await loadSdk(), TOKEN, BASE);

		posthog.capture('before_opt_in');
		await net.flush();
		expect(net.events).toHaveLength(0);
		expect(Object.keys(localStorage)).toEqual([]);

		posthog.opt_in_capturing({ captureEventName: false });
		posthog.capture('after_opt_in');
		await net.flush();
		expect(net.events.map((e) => e.event)).toEqual(['after_opt_in']);
		expect(localStorage.getItem(`ph_${TOKEN}_posthog`)).not.toBeNull();
	});

	it('restores the persisted identity in another instance sharing storage', async () => {
		const sdk = await loadSdk();
		const first = await initAndWait(sdk, TOKEN, BASE);
		first.opt_in_capturing({ captureEventName: false });
		const id = first.get_distinct_id();

		// Shared-store characterization: a named instance in the same window reads the
		// same localStorage and SDK consent marker. It is not a second document.
		const second = await initAndWait(sdk, TOKEN, BASE, 'second');
		expect(second.get_distinct_id()).toBe(id);
		expect(second.is_capturing()).toBe(true);
	});

	it('stops capturing after reset under rejecting defaults', async () => {
		const posthog = await initAndWait(await loadSdk(), TOKEN, BASE);
		posthog.opt_in_capturing({ captureEventName: false });
		posthog.capture('positive_control');
		posthog.reset();
		posthog.capture('after_reset');
		await net.flush();
		expect(net.events.map((e) => e.event)).toEqual(['positive_control']);
		expect(posthog.is_capturing()).toBe(false);
	});

	it('removes the main persistence entry on opt-out', async () => {
		const posthog = await initAndWait(await loadSdk(), TOKEN, BASE);
		posthog.opt_in_capturing({ captureEventName: false });
		expect(localStorage.getItem(`ph_${TOKEN}_posthog`)).not.toBeNull();

		posthog.opt_out_capturing();
		expect(localStorage.getItem(`ph_${TOKEN}_posthog`)).toBeNull();
		expect(sessionStorage.getItem(`ph_${TOKEN}_posthog`)).toBeNull();
	});

	it('sends $identify with the previous anonymous id', async () => {
		const posthog = await initAndWait(await loadSdk(), TOKEN, BASE);
		posthog.opt_in_capturing({ captureEventName: false });
		const anonymous = posthog.get_distinct_id();

		posthog.identify('user_1');
		await net.flush();
		const identify = net.events.find((e) => e.event === '$identify');
		expect(identify?.properties.distinct_id).toBe('user_1');
		expect(identify?.properties.$anon_distinct_id).toBe(anonymous);
	});

	it('extracts campaign scalars and search keywords outside the URL', async () => {
		window.history.replaceState(null, '', '/?utm_source=person%40example.test&gad_source=1');
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			value: 'https://www.google.com/search?q=SEARCH_SENTINEL'
		});
		const posthog = await initAndWait(await loadSdk(), TOKEN, BASE);
		posthog.opt_in_capturing({ captureEventName: false });
		posthog.capture('$pageview');
		await net.flush();
		Object.defineProperty(document, 'referrer', { configurable: true, value: '' });

		const body = net.serialized();
		// Positive controls for the sanitizer: these families exist in raw SDK payloads.
		expect(body).toContain('"utm_source":"person@example.test"');
		expect(body).toContain('gad_source');
		expect(body).toContain('SEARCH_SENTINEL');
		expect(body).toMatch(/ph_keyword/);
	});
});
