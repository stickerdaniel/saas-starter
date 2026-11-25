import type { PostHog } from 'posthog-js/dist/module.slim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPosthogInstance, loadPosthog, type PosthogInstanceOptions } from './posthog';
import { analyticsStorageKeys } from './storage';
import { installNetworkRecorder, resetBrowserStores } from './testing/sdk-harness';

const net = installNetworkRecorder();

describe('createPosthogInstance', () => {
	// Surveys load extra SDK code and fetch survey definitions; the app ships none.
	it('initializes the SDK with surveys disabled', () => {
		const init = vi.fn();
		createPosthogInstance({ init } as unknown as PostHog, {
			apiKey: 'phc_test',
			apiHost: 'https://eu.i.posthog.com',
			uiHost: undefined,
			persistence: 'memory',
			beforeSend: (event) => event,
			name: 'app'
		});

		expect(init).toHaveBeenCalledExactlyOnceWith(
			'phc_test',
			expect.objectContaining({ disable_surveys: true }),
			'app'
		);
	});
});

describe('the loaded SDK with the app options', () => {
	const live: PostHog[] = [];
	let sequence = 0;

	beforeEach(() => {
		net.reset();
		resetBrowserStores();
	});

	afterEach(() => {
		for (const sdk of live.splice(0)) sdk.opt_out_capturing();
		resetBrowserStores();
	});

	async function create(options: Omit<PosthogInstanceOptions, 'apiHost' | 'uiHost'>) {
		const sdk = createPosthogInstance(await loadPosthog(), {
			...options,
			apiHost: 'https://eu.i.posthog.com',
			uiHost: undefined
		});
		if (!sdk) throw new Error(`PostHog did not initialize ${options.name}`);
		live.push(sdk);
		return sdk;
	}

	function expectNoIdentity(token: string) {
		const keys = analyticsStorageKeys(token);
		expect(localStorage.getItem(keys.main)).toBeNull();
		expect(sessionStorage.getItem(keys.windowId)).toBeNull();
		expect(document.cookie).not.toMatch(/(^|; )ph_/);
	}

	it('captures and stores nothing until opt-in, and opts in one named instance only', async () => {
		const n = ++sequence;
		const beforeSendA = vi.fn((event) => event);
		const beforeSendB = vi.fn((event) => event);
		const a = await create({
			apiKey: `phc_slim_a_${n}`,
			persistence: 'localStorage',
			beforeSend: beforeSendA,
			name: `slim_a_${n}`
		});
		const b = await create({
			apiKey: `phc_slim_b_${n}`,
			persistence: 'localStorage',
			beforeSend: beforeSendB,
			name: `slim_b_${n}`
		});

		expect(a).not.toBe(b);
		expect(a.capture('before_opt_in')).toBeUndefined();
		expect(b.capture('before_opt_in')).toBeUndefined();
		await net.flush();
		expect(net.urls).toEqual([]);
		expect(beforeSendA).not.toHaveBeenCalled();
		expectNoIdentity(`phc_slim_a_${n}`);
		expectNoIdentity(`phc_slim_b_${n}`);

		a.opt_in_capturing({ captureEventName: false });
		expect(b.is_capturing()).toBe(false);
		expect(a.capture('after_opt_in', { sentinel: 'allowed' })).toBeDefined();
		await net.flush();
		expect(beforeSendA).toHaveBeenCalledOnce();
		expect(beforeSendB).not.toHaveBeenCalled();
		expect(net.events.map((event) => event.event)).toEqual(['after_opt_in']);
		expect(net.events[0]?.properties.sentinel).toBe('allowed');
		expect(net.urls.map((url) => new URL(url).pathname)).toEqual(['/e/']);
		expectNoIdentity(`phc_slim_b_${n}`);
	});

	it('keeps identity out of browser storage with memory persistence after opt-in', async () => {
		const n = ++sequence;
		const token = `phc_slim_memory_${n}`;
		const sdk = await create({
			apiKey: token,
			persistence: 'memory',
			beforeSend: (event) => event,
			name: `slim_memory_${n}`
		});

		sdk.opt_in_capturing({ captureEventName: false });
		expect(sdk.capture('memory_after_opt_in')).toBeDefined();
		await net.flush();
		expect(net.events.map((event) => event.event)).toEqual(['memory_after_opt_in']);
		expectNoIdentity(token);
	});
});
