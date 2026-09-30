/**
 * The controller with the real pinned SDK in jsdom. Network is stubbed at the
 * transport boundary and request bodies are decoded, so assertions see exactly what
 * would reach PostHog. A second controller in the same window models another tab or
 * a reload: it shares cookies and storage. jsdom has one sessionStorage, so per-tab
 * session storage is not modelled.
 */
import type { PostHog } from 'posthog-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAnalyticsConfig } from './config';
import { AnalyticsController, NOT_FOUND_ROUTE_ID, type ControllerDeps } from './controller';
import type { AuthState } from './identity';
import { loadPosthog } from './posthog';
import { analyticsStorageKeys } from './storage';
import { installNetworkRecorder, resetBrowserStores, type SentEvent } from './testing/sdk-harness';

const net = installNetworkRecorder();
const TOKEN = 'phc_controller';
const KEYS = analyticsStorageKeys(TOKEN);
const ANONYMOUS: AuthState = { kind: 'anonymous' };
const user = (userId: string): AuthState => ({ kind: 'user', userId });

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
	harness.controller = new AnalyticsController({
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
	});
	return harness;
}

async function settle(): Promise<void> {
	await net.flush(60);
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

	it('closes admission from the moment a sign-out starts until the new session is known', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		// The session atom still reports user_1 when the sign-out request is sent.
		harness.controller.beginAuthChange();
		harness.controller.capture('during_sign_out');
		harness.controller.setAuth(user('user_1'));
		harness.controller.setAuth({ kind: 'pending' });
		harness.controller.capture('during_refetch');
		await settle();
		expect(eventsNamed('during_sign_out')).toEqual([]);
		expect(eventsNamed('during_refetch')).toEqual([]);

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

	it('reopens admission when an auth change fails before any refetch', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.grant();
		await settle();

		harness.controller.beginAuthChange();
		harness.controller.cancelAuthChange();
		harness.controller.capture('after_cancel');
		await settle();
		expect(eventsNamed('after_cancel')).toHaveLength(1);
		expect(eventsNamed('after_cancel')[0]?.properties.distinct_id).toBe('user_1');
	});

	it('opens normally when a sign-out finished before the visitor allowed analytics', async () => {
		const harness = makeController();
		navigate('/en/app', '/[[lang]]/app', harness);
		harness.controller.setAuth(user('user_1'));
		harness.controller.start();
		harness.controller.beginAuthChange();
		harness.controller.setAuth({ kind: 'pending' });
		harness.controller.setAuth(ANONYMOUS);
		harness.controller.grant();
		await settle();
		const [pageview] = eventsNamed('$pageview');
		expect(pageview?.properties.distinct_id).not.toBe('user_1');
		expect(eventsNamed('$identify')).toEqual([]);
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
