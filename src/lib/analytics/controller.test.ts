/**
 * The controller with the real pinned SDK in jsdom. Network is stubbed at the
 * transport boundary and request bodies are decoded, so assertions see exactly what
 * would reach PostHog. A second controller in the same window models another tab or
 * a reload: it shares cookies and storage. jsdom has one sessionStorage, so per-tab
 * session storage is not modelled.
 */
import type { PostHog } from 'posthog-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthClient } from 'better-auth/svelte';
import { duringAuthChange, setAnalyticsController } from './client';
import { resolveAnalyticsConfig } from './config';
import { AnalyticsController, NOT_FOUND_ROUTE_ID, type ControllerDeps } from './controller';
import type { AuthState } from './identity';
import { loadPosthog } from './posthog';
import { followSession, type SessionSource } from './session';
import { analyticsStorageKeys } from './storage';
import { installNetworkRecorder, resetBrowserStores, type SentEvent } from './testing/sdk-harness';

const net = installNetworkRecorder();
const TOKEN = 'phc_controller';
const KEYS = analyticsStorageKeys(TOKEN);
const ANONYMOUS: AuthState = { kind: 'anonymous' };
const user = (userId: string): AuthState => ({ kind: 'user', userId });

/** Every controller of the current test; disposed afterwards so none outlives it. */
const live: AnalyticsController[] = [];
/** SDK imports still running, so settle() can wait for them instead of a fixed delay. */
const inflight = new Set<Promise<unknown>>();

interface Harness {
	controller: AnalyticsController;
	created: PostHog[];
	loads: number;
}

function makeController(overrides: Partial<ControllerDeps> = {}): Harness {
	const harness = { created: [] as PostHog[], loads: 0 } as Harness;
	const config = resolveAnalyticsConfig(
		{ apiKey: TOKEN, apiHost: 'https://eu.i.posthog.com', allowedHosts: 'localhost' },
		'localhost'
	);
	const deps: ControllerDeps = {
		config,
		stores: { localStorage, sessionStorage, document, hostname: 'localhost', secure: false },
		getLocalStorage: () => localStorage,
		getSessionStorage: () => sessionStorage,
		cookies: { read: () => document.cookie, write: (cookie) => (document.cookie = cookie) },
		loadSdk: async () => {
			harness.loads += 1;
			const real = await loadPosthog();
			// Record the instance the controller creates, without a production test seam.
			const recording = Object.create(real) as PostHog;
			recording.init = ((...args: Parameters<PostHog['init']>) => {
				const instance = real.init(...args);
				if (instance) harness.created.push(instance as PostHog);
				return instance;
			}) as PostHog['init'];
			return recording;
		},
		scheduleIdle: (task) => {
			const id = setTimeout(task, 0);
			return () => clearTimeout(id);
		},
		setTimer: () => () => {},
		nowSeconds: () => Math.floor(Date.now() / 1000),
		location: () => window.location,
		notifyOtherTabs: () => {},
		...overrides
	};
	const load = deps.loadSdk;
	deps.loadSdk = () => {
		const task = load();
		inflight.add(task);
		void task.catch(() => {}).finally(() => inflight.delete(task));
		return task;
	};
	harness.controller = new AnalyticsController(deps);
	live.push(harness.controller);
	return harness;
}

/** Runs idle tasks, SDK imports and request decoding until nothing is left. */
async function settle(): Promise<void> {
	for (let round = 0; round < 10; round += 1) {
		await net.flush();
		if (inflight.size === 0) break;
		await Promise.race([
			Promise.allSettled([...inflight]),
			new Promise((resolve) => setTimeout(resolve, 1000))
		]);
	}
	await net.flush();
}

function navigate(path: string, routeId: string | null, { controller }: Harness): void {
	window.history.pushState(null, '', path);
	controller.setRoute(routeId, new URL(path, window.location.origin).pathname);
}

const eventsNamed = (name: string): SentEvent[] =>
	net.events.filter((event) => event.event === name);

beforeEach(() => {
	net.reset();
	resetBrowserStores();
	window.history.replaceState(null, '', '/en');
});

afterEach(() => {
	for (const controller of live.splice(0)) controller.dispose();
	resetBrowserStores();
	Object.defineProperty(document, 'referrer', { configurable: true, value: '' });
});

describe('before a decision', () => {
	it('loads nothing, sends nothing and stores nothing while consent is pending', async () => {
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		await settle();

		expect(harness.loads).toBe(0);
		expect(net.urls).toEqual([]);
		expect(Object.keys(localStorage)).toEqual([]);
		expect(harness.controller.state).toEqual({
			enabled: true,
			status: 'pending',
			bannerOpen: true
		});
	});

	it('stays inert after a refusal and on disabled configuration', async () => {
		document.cookie = 'analytics_consent=v1.denied; Path=/';
		const denied = makeController();
		denied.controller.start();

		const disabled = new AnalyticsController({
			...({} as ControllerDeps),
			config: { enabled: false, reason: 'host_not_allowed' }
		});
		disabled.start();
		expect(disabled.grant()).toBe(false);
		await settle();

		expect(denied.loads).toBe(0);
		expect(denied.controller.state.bannerOpen).toBe(false);
		expect(disabled.state.enabled).toBe(false);
		expect(net.urls).toEqual([]);
	});

	it('does not start on a 404 page until a known route is shown', async () => {
		const harness = makeController();
		window.history.replaceState(null, '', '/en/jane-doe');
		harness.controller.setRoute(NOT_FOUND_ROUTE_ID, '/en/jane-doe');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		expect(harness.loads).toBe(0);

		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', harness);
		await settle();
		expect(eventsNamed('$pageview').map((event) => event.properties.$pathname)).toEqual([
			'/en/pricing'
		]);
		expect(net.serialized()).not.toContain('jane-doe');
	});

	it('waits for the settled page to match the address bar and skips error pages', async () => {
		const harness = makeController();
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		// The history entry moved on before SvelteKit settled the page state.
		window.history.replaceState(null, '', '/en/pricing');
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		// An error rendered for a known path.
		harness.controller.setRoute('/[[lang]]/(marketing)/pricing', '/en/pricing', false);
		harness.controller.setRoute(null, '/en/pricing');
		await settle();
		expect(harness.loads).toBe(0);

		harness.controller.setRoute('/[[lang]]/(marketing)/pricing', '/en/pricing');
		await settle();
		expect(eventsNamed('$pageview').map((event) => event.properties.$pathname)).toEqual([
			'/en/pricing'
		]);
	});
});

describe('after consent', () => {
	it('sends a sanitized landing pageview and only to the capture endpoint', async () => {
		window.history.replaceState(
			null,
			'',
			'/en/reset-password?token=SECRET&other=OTHER&utm_source=gh&utm_medium=person%40example.test#frag'
		);
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			value: 'https://www.google.com/search?q=SEARCH'
		});
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(auth)/reset-password', '/en/reset-password');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();

		const [landing] = eventsNamed('$pageview');
		expect(landing?.properties.$current_url).toBe(
			'http://localhost:3000/en/reset-password?utm_source=gh'
		);
		expect(landing?.properties.utm_source).toBe('gh');
		expect(landing?.properties.$referrer).toBe('https://www.google.com');
		const body = net.serialized();
		for (const sentinel of ['SECRET', 'OTHER', 'SEARCH', 'frag', 'person@']) {
			expect(body).not.toContain(sentinel);
		}
		expect(net.urls.every((url) => new URL(url).pathname === '/e/')).toBe(true);
	});

	it('merges the anonymous visitor into the user who signs in', async () => {
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		const anonymousId = eventsNamed('$pageview')[0]?.properties.distinct_id;
		expect(anonymousId).toEqual(expect.any(String));

		harness.controller.setAuth(user('user_1'));
		navigate('/en/app', '/[[lang]]/app', harness);
		await settle();

		const identify = eventsNamed('$identify');
		expect(identify).toHaveLength(1);
		expect(identify[0]?.properties.distinct_id).toBe('user_1');
		expect(identify[0]?.properties.$anon_distinct_id).toBe(anonymousId);
		expect(eventsNamed('$pageview').at(-1)?.properties.distinct_id).toBe('user_1');
		expect(net.serialized()).not.toMatch(/"(email|name)"/);
	});

	it('starts a fresh anonymous identity on account switch and sign-out', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		harness.controller.setAuth(user('user_2'));
		await settle();
		const switched = eventsNamed('$identify').at(-1);
		expect(switched?.properties.distinct_id).toBe('user_2');
		expect(switched?.properties.$anon_distinct_id).not.toBe('user_1');

		harness.controller.setAuth(ANONYMOUS);
		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', harness);
		await settle();
		const last = eventsNamed('$pageview').at(-1)?.properties.distinct_id;
		expect(last).not.toBe('user_1');
		expect(last).not.toBe('user_2');
	});

	it('holds pageviews during a session refetch and sends exactly one afterwards', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();
		const before = eventsNamed('$pageview').length;

		harness.controller.setAuth({ kind: 'pending' });
		navigate('/en/app/settings', '/[[lang]]/app/settings', harness);
		await settle();
		expect(eventsNamed('$pageview')).toHaveLength(before);

		harness.controller.setAuth(user('user_1'));
		harness.controller.setAuth(user('user_1'));
		await settle();
		const pageviews = eventsNamed('$pageview');
		expect(pageviews).toHaveLength(before + 1);
		expect(pageviews.at(-1)?.properties.$pathname).toBe('/en/app/settings');
	});

	it('sends nothing while an admin impersonates a user', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth({ kind: 'impersonating' });
		harness.controller.start();
		harness.controller.grant();
		navigate('/en/app/settings', '/[[lang]]/app/settings', harness);
		harness.controller.capture('clicked_something');
		await settle();
		expect(net.events).toEqual([]);
	});

	it('stays closed from the start of a sign-out until the session is fetched after it', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		// The session store still reports user_1 while the request runs, and an
		// unrelated refresh completes before the request does.
		const operation = harness.controller.beginAuthChange();
		harness.controller.capture('during_sign_out');
		harness.controller.setAuth({ kind: 'pending' });
		harness.controller.setAuth(user('user_1'));
		harness.controller.capture('after_unrelated_refresh');
		harness.controller.endAuthChange(operation, 'changed');
		harness.controller.capture('before_session_refetch');
		harness.controller.setAuth({ kind: 'pending' });
		await settle();
		for (const name of ['during_sign_out', 'after_unrelated_refresh', 'before_session_refetch']) {
			expect(eventsNamed(name)).toEqual([]);
		}
		expect(eventsNamed('$pageview')).toHaveLength(1);

		harness.controller.setAuth(ANONYMOUS);
		await settle();
		const pageviews = eventsNamed('$pageview');
		expect(pageviews).toHaveLength(2);
		expect(pageviews[1]?.properties.distinct_id).not.toBe('user_1');
		expect(pageviews[1]?.properties.$pathname).toBe('/en/app');
		expect(
			Object.keys(pageviews[1]!.properties).filter((key) => key.startsWith('$prev_pageview_'))
		).toEqual([]);
	});

	it('reopens when the server refused the change, and only after every change ended', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		const first = harness.controller.beginAuthChange();
		const second = harness.controller.beginAuthChange();
		harness.controller.endAuthChange(second, 'unchanged');
		harness.controller.capture('while_first_runs');
		harness.controller.endAuthChange(first, 'unchanged');
		harness.controller.capture('after_both');
		await settle();
		expect(eventsNamed('while_first_runs')).toEqual([]);
		expect(eventsNamed('after_both')[0]?.properties.distinct_id).toBe('user_1');
	});

	it('treats a failed request as a possible change', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		const operation = harness.controller.beginAuthChange();
		harness.controller.endAuthChange(operation, 'unknown');
		harness.controller.capture('after_failed_request');
		harness.controller.setAuth({ kind: 'pending' });
		harness.controller.setAuth(user('user_1'));
		harness.controller.capture('after_session_confirmed');
		await settle();
		expect(eventsNamed('after_failed_request')).toEqual([]);
		expect(eventsNamed('after_session_confirmed')).toHaveLength(1);
	});

	it('opens normally when a sign-out finished before the visitor allowed analytics', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		const operation = harness.controller.beginAuthChange();
		harness.controller.endAuthChange(operation, 'changed');
		harness.controller.setAuth({ kind: 'pending' });
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.grant();
		await settle();
		const [pageview] = eventsNamed('$pageview');
		expect(pageview?.properties.distinct_id).not.toBe('user_1');
		expect(eventsNamed('$identify')).toEqual([]);
	});

	it('checks a session change that arrives before the route settles', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		// The address bar moved on; SvelteKit has not settled the new page yet.
		window.history.pushState(null, '', '/en/app/settings');
		harness.controller.setAuth({ kind: 'impersonating' });
		harness.controller.setRoute('/[[lang]]/app/settings', '/en/app/settings');
		harness.controller.capture('while_impersonating');
		await settle();
		expect(eventsNamed('while_impersonating')).toEqual([]);
		expect(eventsNamed('$pageview')).toHaveLength(1);

		window.history.pushState(null, '', '/en/app');
		harness.controller.setAuth(user('user_2'));
		harness.controller.setRoute('/[[lang]]/app', '/en/app');
		await settle();
		const identify = eventsNamed('$identify').at(-1);
		expect(identify?.properties.distinct_id).toBe('user_2');
		expect(identify?.properties.$anon_distinct_id).not.toBe('user_1');
		expect(eventsNamed('$pageview').at(-1)?.properties.distinct_id).toBe('user_2');
	});

	it('does not link an account switch to the previous account on the same page', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();
		const firstPageviewId = eventsNamed('$pageview')[0]?.properties.$pageview_id;

		harness.controller.setAuth(user('user_2'));
		await settle();
		const identify = eventsNamed('$identify').at(-1)!;
		expect(identify.properties.distinct_id).toBe('user_2');
		expect(identify.properties).not.toHaveProperty('$pageview_id');
		const pageview = eventsNamed('$pageview').at(-1)!;
		expect(pageview.properties.distinct_id).toBe('user_2');
		expect(pageview.properties.$pageview_id).not.toBe(firstPageviewId);
		expect(
			Object.keys(pageview.properties).filter((key) => key.startsWith('$prev_pageview_'))
		).toEqual([]);
	});
});

describe('withdrawal and expiry', () => {
	it('admits no event after withdrawal and removes the stored identity', async () => {
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		expect(eventsNamed('$pageview')).toHaveLength(1);
		expect(localStorage.getItem(KEYS.main)).not.toBeNull();
		const admitted = new Set(net.events.map((event) => event.uuid));

		harness.controller.deny();
		harness.controller.capture('after_withdrawal');
		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', harness);
		harness.created[0]?.capture('sdk_after_withdrawal');
		await settle();

		expect(net.events.filter((event) => !admitted.has(event.uuid))).toEqual([]);
		expect(localStorage.getItem(KEYS.main)).toBeNull();
		expect(localStorage.getItem(KEYS.periodStamp)).toBeNull();
		expect(sessionStorage.getItem(KEYS.windowId)).toBeNull();
		expect(harness.controller.state.status).toBe('denied');
	});

	it('drops SDK events once the consent cookie is gone, even while the SDK marker still grants', async () => {
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		const sdk = harness.created[0];
		expect(sdk?.is_capturing()).toBe(true);

		document.cookie = 'analytics_consent=; Max-Age=0; Path=/';
		sdk?.capture('after_expiry');
		await settle();
		expect(eventsNamed('after_expiry')).toEqual([]);

		harness.controller.reconcile();
		expect(localStorage.getItem(KEYS.main)).toBeNull();
		expect(harness.controller.state).toMatchObject({ status: 'pending', bannerOpen: true });
	});

	it('starts a new identity with no links to the previous period on regrant', async () => {
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		const first = eventsNamed('$pageview')[0]!;

		harness.controller.deny();
		harness.controller.grant();
		await settle();
		const second = eventsNamed('$pageview').at(-1)!;

		expect(second.uuid).not.toBe(first.uuid);
		expect(second.properties.distinct_id).not.toBe(first.properties.distinct_id);
		expect(second.properties.$device_id).not.toBe(first.properties.$device_id);
		expect(second.properties.$pageview_id).not.toBe(first.properties.$pageview_id);
		expect(
			Object.keys(second.properties).filter((key) => key.startsWith('$prev_pageview_'))
		).toEqual([]);
	});

	it('bounds the expiry timer and ignores a timer left from an earlier period', async () => {
		const timers: Array<{ task: () => void; ms: number }> = [];
		const harness = makeController({
			setTimer: (task, ms) => {
				timers.push({ task, ms });
				return () => {};
			}
		});
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		// 180 days exceed what setTimeout accepts; a larger delay would fire at once.
		expect(timers.at(-1)?.ms).toBe(2_147_483_647);
		const stale = timers.at(-1)!;

		harness.controller.deny();
		harness.controller.grant();
		await settle();
		stale.task();
		harness.controller.capture('after_stale_timer');
		await settle();
		expect(harness.controller.state.status).toBe('granted');
		expect(eventsNamed('after_stale_timer')).toHaveLength(1);
	});

	it('keeps the visitor when consent is confirmed again', async () => {
		const harness = makeController();
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		const cookie = document.cookie;

		harness.controller.openPreferences();
		expect(harness.controller.grant()).toBe(true);
		harness.controller.capture('confirmed');
		await settle();
		expect(document.cookie).toBe(cookie);
		expect(eventsNamed('confirmed')[0]?.properties.distinct_id).toBe(
			eventsNamed('$pageview')[0]?.properties.distinct_id
		);
		expect(harness.controller.state.bannerOpen).toBe(false);
	});
});

describe('several documents', () => {
	it('keeps the same visitor across a reload within one consent period', async () => {
		const first = makeController();
		first.controller.setRoute('/[[lang]]/(marketing)', '/en');
		first.controller.setAuth(ANONYMOUS);
		first.controller.start();
		first.controller.grant();
		await settle();
		const visitor = eventsNamed('$pageview')[0]?.properties.distinct_id;

		const reloaded = makeController();
		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', reloaded);
		reloaded.controller.setAuth(ANONYMOUS);
		reloaded.controller.start();
		await settle();

		expect(eventsNamed('$pageview').at(-1)?.properties.distinct_id).toBe(visitor);
	});

	it('pauses a tab that observes a grant made elsewhere; its reload adopts that grant', async () => {
		const tabA = makeController();
		tabA.controller.setRoute('/[[lang]]/(marketing)', '/en');
		tabA.controller.setAuth(ANONYMOUS);
		tabA.controller.start();
		tabA.controller.grant();
		await settle();

		const tabB = makeController();
		tabB.controller.setRoute('/[[lang]]/(marketing)', '/en');
		tabB.controller.setAuth(ANONYMOUS);
		tabB.controller.start();
		await settle();
		tabB.controller.deny();
		tabB.controller.grant();
		await settle();
		const newVisitor = eventsNamed('$pageview').at(-1)?.properties.distinct_id;

		tabA.controller.reconcile();
		net.reset();
		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', tabA);
		tabA.controller.capture('from_paused_tab');
		await settle();
		expect(net.events).toEqual([]);
		// A new grant from the visitor itself is not a paused state either.
		expect(tabA.controller.state.status).toBe('granted');

		const reloadedA = makeController();
		reloadedA.controller.setRoute('/[[lang]]/(marketing)/pricing', '/en/pricing');
		reloadedA.controller.setAuth(ANONYMOUS);
		reloadedA.controller.start();
		await settle();
		expect(eventsNamed('$pageview').at(-1)?.properties.distinct_id).toBe(newVisitor);
	});

	it('starts a fresh visitor when the stored identity belongs to an earlier period', async () => {
		const first = makeController();
		first.controller.setRoute('/[[lang]]/(marketing)', '/en');
		first.controller.setAuth(ANONYMOUS);
		first.controller.start();
		first.controller.grant();
		await settle();
		const visitor = eventsNamed('$pageview')[0]?.properties.distinct_id;
		const stalePeriod = localStorage.getItem(KEYS.periodStamp);

		// Another tab withdrew and granted again without touching this storage.
		document.cookie = `analytics_consent=v1.granted.AAAAAAAAAAAAAAAAAAAAAA.${Math.floor(Date.now() / 1000) + 3600}; Path=/`;
		const fresh = makeController();
		fresh.controller.setRoute('/[[lang]]/(marketing)', '/en');
		fresh.controller.setAuth(ANONYMOUS);
		fresh.controller.start();
		await settle();

		expect(stalePeriod).not.toBe('AAAAAAAAAAAAAAAAAAAAAA');
		expect(eventsNamed('$pageview').at(-1)?.properties.distinct_id).not.toBe(visitor);
		expect(localStorage.getItem(KEYS.periodStamp)).toBe('AAAAAAAAAAAAAAAAAAAAAA');
	});

	it('resumes a paused tab with a fresh identity when its visitor grants there', async () => {
		const tabA = makeController();
		tabA.controller.setRoute('/[[lang]]/(marketing)', '/en');
		tabA.controller.setAuth(ANONYMOUS);
		tabA.controller.start();
		tabA.controller.grant();
		await settle();

		const tabB = makeController();
		tabB.controller.setRoute('/[[lang]]/(marketing)', '/en');
		tabB.controller.setAuth(ANONYMOUS);
		tabB.controller.start();
		await settle();
		tabB.controller.deny();
		tabB.controller.grant();
		await settle();
		tabA.controller.reconcile();

		expect(tabA.controller.grant()).toBe(true);
		tabA.controller.capture('resumed');
		await settle();
		const resumed = eventsNamed('resumed');
		expect(resumed).toHaveLength(1);
		const current = /analytics_consent=v1\.granted\.([^.]+)\./.exec(document.cookie)?.[1];
		expect(localStorage.getItem(KEYS.periodStamp)).toBe(current);
	});

	it('lets only the current start task initialize the SDK', async () => {
		const pending: Array<() => void> = [];
		let loads = 0;
		const held = makeController({
			scheduleIdle: (task) => {
				task();
				return () => {};
			},
			// The import of the first grant is still in flight when the visitor withdraws
			// and grants again.
			loadSdk: () =>
				new Promise<PostHog>((resolve) => {
					loads += 1;
					pending.push(() => void loadPosthog().then(resolve));
				})
		});
		held.controller.setRoute('/[[lang]]/(marketing)', '/en');
		held.controller.setAuth(ANONYMOUS);
		held.controller.start();
		held.controller.grant();
		held.controller.deny();
		held.controller.grant();
		expect(loads).toBe(2);

		for (const resolve of pending) resolve();
		await settle();
		expect(eventsNamed('$pageview')).toHaveLength(1);
		const current = /analytics_consent=v1\.granted\.([^.]+)\./.exec(document.cookie)?.[1];
		expect(localStorage.getItem(KEYS.periodStamp)).toBe(current);
	});

	it('keeps identity in memory when session storage is not durable', async () => {
		const blocked = {
			setItem() {
				throw new DOMException('blocked', 'QuotaExceededError');
			}
		} as unknown as Storage;
		const harness = makeController({ getSessionStorage: () => blocked });
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();

		expect(eventsNamed('$pageview')).toHaveLength(1);
		expect(localStorage.getItem(KEYS.main)).toBeNull();
		expect(localStorage.getItem(KEYS.periodStamp)).toBeNull();
		expect(document.cookie).not.toMatch(/(^|; )ph_/);
	});
});

describe('browser failures', () => {
	function blockableCookies() {
		const control = {
			writes: 'allow' as 'allow' | 'throw' | 'ignore',
			reads: 'allow' as 'allow' | 'throw'
		};
		const cookies = {
			read: () => {
				if (control.reads === 'throw') throw new DOMException('blocked', 'SecurityError');
				return document.cookie;
			},
			write: (cookie: string) => {
				if (control.writes === 'throw') throw new DOMException('blocked', 'SecurityError');
				if (control.writes === 'allow') document.cookie = cookie;
			}
		};
		return { control, cookies };
	}

	async function grantedHarness(cookies: ControllerDeps['cookies']): Promise<Harness> {
		const harness = makeController({ cookies });
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		expect(eventsNamed('$pageview')).toHaveLength(1);
		return harness;
	}

	it('closes capture when the browser refuses to store a withdrawal', async () => {
		for (const mode of ['throw', 'ignore'] as const) {
			net.reset();
			resetBrowserStores();
			const { control, cookies } = blockableCookies();
			const harness = await grantedHarness(cookies);
			control.writes = mode;

			expect(harness.controller.deny()).toBe(false);
			harness.controller.capture(`after_${mode}`);
			await settle();
			expect(eventsNamed(`after_${mode}`)).toEqual([]);
			expect(harness.controller.isAdmitted()).toBe(false);
			expect(localStorage.getItem(KEYS.main)).toBeNull();
		}
	});

	it('stays closed while the consent cookie cannot be read', async () => {
		const { control, cookies } = blockableCookies();
		const harness = await grantedHarness(cookies);
		control.reads = 'throw';
		harness.controller.capture('unreadable');
		harness.controller.reconcile();
		await settle();
		expect(eventsNamed('unreadable')).toEqual([]);
		expect(harness.controller.state.status).toBe('pending');
	});

	it('starts again after a failed SDK import', async () => {
		let failNext = true;
		const harness = makeController({
			loadSdk: async () => {
				if (failNext) {
					failNext = false;
					throw new Error('chunk unavailable');
				}
				return loadPosthog();
			}
		});
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		await settle();
		expect(net.events).toEqual([]);

		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', harness);
		await settle();
		expect(eventsNamed('$pageview').map((event) => event.properties.$pathname)).toEqual([
			'/en/pricing'
		]);
	});

	it('does not import the SDK when the visitor left the known route before idle time', async () => {
		const idle: Array<() => void> = [];
		const harness = makeController({
			scheduleIdle: (task) => {
				idle.push(task);
				return () => {};
			}
		});
		harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.start();
		harness.controller.grant();
		navigate('/en/jane-doe', NOT_FOUND_ROUTE_ID, harness);
		for (const task of idle.splice(0)) task();
		await settle();
		expect(harness.loads).toBe(0);

		navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', harness);
		for (const task of idle.splice(0)) task();
		await settle();
		expect(harness.loads).toBe(1);
		expect(eventsNamed('$pageview')).toHaveLength(1);
	});
});

describe('duringAuthChange', () => {
	it('keeps analytics closed for as long as the wrapped request runs', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();
		setAnalyticsController(harness.controller);

		let finish: (result: { error: unknown }) => void = () => {};
		const request = duringAuthChange(
			() => new Promise<{ error: unknown }>((resolve) => (finish = resolve)),
			(result) => !result.error
		);
		// A session refresh unrelated to the request completes while it runs.
		harness.controller.setAuth({ kind: 'pending' });
		harness.controller.setAuth(user('user_1'));
		harness.controller.capture('while_running');
		finish({ error: { status: 403 } });
		await request;
		harness.controller.capture('after_refusal');
		await settle();
		setAnalyticsController(undefined);

		expect(eventsNamed('while_running')).toEqual([]);
		expect(eventsNamed('after_refusal')).toHaveLength(1);
	});
});

describe('following the Better Auth session store', () => {
	/** A Better Auth client whose session requests wait until the test answers them. */
	function heldAuthClient() {
		const requests: Array<(body: unknown) => void> = [];
		const client = createAuthClient({
			baseURL: 'http://localhost:3000',
			fetchOptions: {
				customFetchImpl: () =>
					new Promise<Response>((resolve) => {
						requests.push((body) =>
							resolve(
								new Response(JSON.stringify(body), {
									status: 200,
									headers: { 'content-type': 'application/json' }
								})
							)
						);
					})
			}
		});
		return { client, requests };
	}
	const signedIn = (userId: string) => ({
		user: { id: userId, email: `${userId}@example.test`, name: userId },
		session: { id: `session_${userId}`, userId, expiresAt: '2099-01-01T00:00:00.000Z' }
	});

	it('reopens after a sign-out whose session fetch replaced one already running', async () => {
		const { client, requests } = heldAuthClient();
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		const stop = followSession(harness.controller, client as unknown as SessionSource);
		await settle();
		requests.shift()?.(signedIn('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();
		expect(eventsNamed('$identify')[0]?.properties.distinct_id).toBe('user_1');

		const operation = harness.controller.beginAuthChange();
		// A focus refresh starts while the sign-out request runs and is still open
		// when the sign-out finishes.
		void client.$store.atoms.session?.get().refetch();
		await settle();
		const staleRequest = requests.shift();
		harness.controller.endAuthChange(operation, 'changed');
		harness.controller.capture('before_signal');
		// Better Auth toggles the signal after the sign-out; its fetch aborts the old one.
		client.$store.notify('$sessionSignal');
		await settle();
		requests.shift()?.(null);
		staleRequest?.(signedIn('user_1'));
		await settle();
		harness.controller.capture('after_sign_out');
		await settle();
		stop();

		expect(eventsNamed('before_signal')).toEqual([]);
		const [afterSignOut] = eventsNamed('after_sign_out');
		expect(afterSignOut?.properties.distinct_id).toEqual(expect.any(String));
		expect(afterSignOut?.properties.distinct_id).not.toBe('user_1');
	});
});

describe('interrupted starts', () => {
	it('starts again after the consent cookie was unreadable while a start ran', async () => {
		for (const phase of ['before_import', 'during_import'] as const) {
			net.reset();
			resetBrowserStores();
			window.history.replaceState(null, '', '/en');
			let unreadable = false;
			let imports = 0;
			const idle: Array<() => void> = [];
			const harness = makeController({
				cookies: {
					read: () => {
						if (unreadable) throw new DOMException('blocked', 'SecurityError');
						return document.cookie;
					},
					write: (cookie) => {
						document.cookie = cookie;
					}
				},
				scheduleIdle: (task) => {
					idle.push(task);
					return () => {};
				},
				loadSdk: async () => {
					// Only the first import coincides with the unreadable cookie.
					imports += 1;
					if (phase === 'during_import' && imports === 1) unreadable = true;
					return loadPosthog();
				}
			});
			harness.controller.setRoute('/[[lang]]/(marketing)', '/en');
			harness.controller.setAuth(ANONYMOUS);
			harness.controller.start();
			harness.controller.grant();
			if (phase === 'before_import') unreadable = true;
			for (const task of idle.splice(0)) task();
			await settle();
			unreadable = false;
			expect(net.events).toEqual([]);

			harness.controller.reconcile();
			navigate('/en/pricing', '/[[lang]]/(marketing)/pricing', harness);
			for (const task of idle.splice(0)) task();
			await settle();
			expect(eventsNamed('$pageview').map((event) => event.properties.$pathname)).toEqual([
				'/en/pricing'
			]);
		}
	});
});
