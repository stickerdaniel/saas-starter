/**
 * Contract of the pinned posthog-js release when browser storage is unusable from
 * page load. Separate file so the SDK is first imported with storage already blocked.
 */
import { expect, it } from 'vitest';
import { initAndWait, installNetworkRecorder, loadSdk } from './testing/sdk-harness';

const net = installNetworkRecorder();
for (const name of ['localStorage', 'sessionStorage'] as const) {
	Object.defineProperty(window, name, {
		configurable: true,
		get() {
			throw new DOMException('blocked', 'SecurityError');
		}
	});
}

it('keeps consent and identity in memory without setting a PostHog cookie', async () => {
	const posthog = await initAndWait(await loadSdk(), 'phc_blocked', {
		api_host: 'https://eu.i.posthog.com',
		persistence: 'memory',
		opt_out_capturing_by_default: true,
		opt_out_persistence_by_default: true,
		capture_pageview: false,
		capture_pageleave: false,
		autocapture: false,
		disable_session_recording: true,
		advanced_disable_flags: true,
		disable_external_dependency_loading: true,
		request_batching: false
	});
	posthog.opt_in_capturing({ captureEventName: false });
	posthog.capture('positive_control');
	await net.flush();

	expect(net.events.map((event) => event.event)).toEqual(['positive_control']);
	expect(document.cookie).not.toMatch(/(^|; )(__ph_opt_in_out_|ph_)/);
});
