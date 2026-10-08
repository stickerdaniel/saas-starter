/**
 * Leaving an investigation, driven through the real Better Auth client.
 *
 * Only the network is replaced: every stop, session read and sign-out goes
 * through `authClient` and Better Fetch, so the error shapes the owner
 * classifies are the ones the client really hands back for an HTTP status.
 * The browser flow around it (the start, the cookie jar across a second tab,
 * the landing page) lives in e2e/admin-support-investigation.spec.ts.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('$app/state', () => ({
	page: { params: { lang: 'en' }, url: new URL('http://localhost') }
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('svelte-sonner', () => ({ toast }));

type Reply = () => Response | Promise<Response>;
const network = vi.hoisted(() => {
	const state = {
		replies: new Map<string, Reply>(),
		requests: [] as string[]
	};
	const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		state.requests.push(url.pathname);
		const reply = state.replies.get(url.pathname);
		if (!reply) throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${url.pathname}`);
		return reply();
	};
	globalThis.fetch = fetchStub as typeof fetch;
	return state;
});

import { flushSync } from 'svelte';
import type * as ImpersonationModule from './use-impersonation.svelte.ts';
import type { ImpersonationState } from './use-impersonation.svelte.ts';
import {
	INVESTIGATION_RETURN_COOKIE,
	clearInvestigationReturn,
	writeInvestigationReturn
} from '#lib/admin/investigation-return.js';

const STOP = '/api/auth/admin/stop-impersonating';
const SESSION = '/api/auth/get-session';
const SIGN_OUT = '/api/auth/sign-out';
const ORIGIN_PAGE = '/en/admin/support?thread=abc&note=a;b=c';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const session = (impersonating: boolean) =>
	json(200, {
		session: {
			id: 'session_1',
			userId: 'user_1',
			token: 'token',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			impersonatedBy: impersonating ? 'admin_1' : null
		},
		user: {
			id: 'user_1',
			name: 'Casey Customer',
			email: 'casey@example.com',
			emailVerified: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}
	});

function count(path: string): number {
	return network.requests.filter((request) => request === path).length;
}

function heldCookie(): string | undefined {
	return document.cookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${INVESTIGATION_RETURN_COOKIE}=`));
}

let navigations: string[] = [];
let locationDescriptor: PropertyDescriptor | undefined;
let dispose: (() => void) | undefined;

let documentLoads = 0;

/**
 * A document-level owner, subscribed to the live session the way the root
 * layout builds it. Each case is its own document load: the module keeps a
 * stop latch for exactly that long.
 */
async function startOwner(): Promise<ImpersonationState> {
	const module = (await import(
		/* @vite-ignore */ `./use-impersonation.svelte.ts?load=${++documentLoads}`
	)) as typeof ImpersonationModule;
	let owner!: ImpersonationState;
	dispose = $effect.root(() => {
		owner = new module.ImpersonationState({ suspendOnce: vi.fn() });
	});
	flushSync();
	await vi.waitFor(() => expect(owner.isImpersonating).toBe(true));
	return owner;
}

// The first import of the hook transforms it and its Better Auth client graph,
// which takes seconds on a cold cache. Paid here, outside any case's deadline,
// so a case cannot time out while its own exit is still running.
beforeAll(async () => {
	await import(/* @vite-ignore */ `./use-impersonation.svelte.ts?load=${documentLoads}`);
}, 60_000);

beforeEach(() => {
	network.requests = [];
	network.replies = new Map([[SESSION, () => session(true)]]);
	navigations = [];
	locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
	const real = window.location;
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			origin: real.origin,
			protocol: real.protocol,
			host: real.host,
			hostname: real.hostname,
			href: real.href,
			pathname: '/en/app',
			search: '',
			assign: (url: string) => navigations.push(url)
		}
	});
	writeInvestigationReturn(ORIGIN_PAGE);
});

afterEach(() => {
	dispose?.();
	dispose = undefined;
	clearInvestigationReturn();
	if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
	vi.clearAllMocks();
});

describe('ImpersonationState exit', () => {
	it('returns to the admin page the investigation began on', async () => {
		const owner = await startOwner();
		network.replies.set(STOP, () => session(false));
		network.replies.set(SESSION, () => session(false));

		await owner.stop((key) => key);

		expect(navigations).toEqual([ORIGIN_PAGE]);
		expect(heldCookie()).toBeUndefined();
		expect(count(STOP)).toBe(1);
	});

	// Any script on the origin can write the cookie, so the exit reads it through
	// the same check a start writes it with.
	it('returns to the users table when the stored page is not an admin page', async () => {
		document.cookie = `${INVESTIGATION_RETURN_COOKIE}=${encodeURIComponent('//evil.example/admin')}; Path=/`;
		const owner = await startOwner();
		network.replies.set(STOP, () => session(false));
		network.replies.set(SESSION, () => session(false));

		await owner.stop((key) => key);

		expect(navigations).toEqual(['/en/admin/users']);
	});

	it.each([
		['an expired impersonation', () => json(401, {})],
		[
			'a lost admin session',
			() =>
				json(500, {
					code: 'FAILED_TO_FIND_ADMIN_SESSION',
					message: 'Failed to find admin session'
				})
		]
	])('asks for a new sign-in after %s and keeps the target', async (_label, reply) => {
		const owner = await startOwner();
		network.replies.set(STOP, reply);

		await owner.stop((key) => key);

		expect(owner.exit).toBe('recovery');
		expect(owner.canSignOut).toBe(false);
		expect(navigations).toEqual([]);
		expect(heldCookie()).toBe(`${INVESTIGATION_RETURN_COOKIE}=${encodeURIComponent(ORIGIN_PAGE)}`);
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('leaves Stop live after any other refused stop', async () => {
		const owner = await startOwner();
		network.replies.set(STOP, () => json(500, { message: 'Failed to find user' }));

		await owner.stop((key) => key);

		expect(owner.exit).toBe('idle');
		expect(toast.error).toHaveBeenCalledWith('app.user_menu.impersonation_stop_failed');
		expect(owner.isImpersonating).toBe(true);
	});

	it.each([
		['answers with an error', () => json(500, { message: 'Internal Server Error' })],
		[
			'never answers',
			() => {
				throw new TypeError('Failed to fetch');
			}
		]
	])('waits for a retry when the session read after a stop %s', async (_label, failingRead) => {
		const owner = await startOwner();
		network.replies.set(STOP, () => session(false));
		network.replies.set(SESSION, failingRead);

		await owner.stop((key) => key);

		expect(owner.exit).toBe('returnPending');
		expect(owner.canSignOut).toBe(false);
		expect(navigations).toEqual([]);
		expect(heldCookie()).toBeDefined();

		// The impersonation is over, so a second stop is not the way out.
		await owner.stop((key) => key);
		network.replies.set(SESSION, () => session(false));
		await owner.retryReturn((key) => key);

		expect(count(STOP)).toBe(1);
		expect(navigations).toEqual([ORIGIN_PAGE]);
	});

	it('sends one stop for two controls pressed together', async () => {
		const owner = await startOwner();
		const answer = Promise.withResolvers<void>();
		network.replies.set(STOP, async () => {
			await answer.promise;
			return session(false);
		});
		network.replies.set(SESSION, () => session(false));

		const first = owner.stop((key) => key);
		const second = owner.stop((key) => key);
		answer.resolve();
		await Promise.all([first, second]);

		expect(count(STOP)).toBe(1);
		expect(navigations).toEqual([ORIGIN_PAGE]);
	});

	it('keeps the recovery when sign-out fails, then signs in toward the target', async () => {
		const owner = await startOwner();
		network.replies.set(STOP, () => json(401, {}));
		await owner.stop((key) => key);

		network.replies.set(SIGN_OUT, () => json(500, { message: 'Sign out failed' }));
		await owner.signInAgain();

		expect(owner.exit).toBe('recovery');
		expect(navigations).toEqual([]);
		expect(heldCookie()).toBeDefined();

		network.replies.set(SIGN_OUT, () => json(200, { success: true }));
		await owner.signInAgain();

		expect(navigations).toEqual([`/en/signin?redirectTo=${encodeURIComponent(ORIGIN_PAGE)}`]);
		expect(heldCookie()).toBeUndefined();
	});
});
