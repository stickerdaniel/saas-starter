/**
 * Starting an investigation, driven through the real Better Auth client with
 * only the network replaced, so a refused start is whatever the client really
 * reports for an HTTP error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('$app/state', () => ({
	page: { params: { lang: 'en' }, url: new URL('http://localhost') }
}));

type Reply = () => Response | Promise<Response>;
const network = vi.hoisted(() => {
	const state = { replies: new Map<string, Reply>(), requests: [] as string[] };
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		state.requests.push(url.pathname);
		const reply = state.replies.get(url.pathname);
		if (!reply) throw new Error(`Unexpected request ${url.pathname}`);
		return reply();
	}) as typeof fetch;
	return state;
});

import { canImpersonateUser, impersonateUser } from './impersonate-user';
import {
	INVESTIGATION_RETURN_COOKIE,
	clearInvestigationReturn,
	readInvestigationReturn,
	writeInvestigationReturn
} from '#lib/admin/investigation-return.js';

const IMPERSONATE = '/api/auth/admin/impersonate-user';
const SESSION = '/api/auth/get-session';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const sessionBody = {
	session: {
		id: 'session_2',
		userId: 'user_1',
		token: 'token',
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		impersonatedBy: 'admin_1'
	},
	user: {
		id: 'user_1',
		name: 'Casey Customer',
		email: 'casey@example.com',
		emailVerified: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	}
};

let navigations: string[] = [];
let locationDescriptor: PropertyDescriptor | undefined;
const page = { pathname: '/en/admin/support', search: '?thread=abc' };

beforeEach(() => {
	network.requests = [];
	network.replies = new Map();
	navigations = [];
	page.pathname = '/en/admin/support';
	page.search = '?thread=abc';
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
			get pathname() {
				return page.pathname;
			},
			get search() {
				return page.search;
			},
			assign: (url: string) => navigations.push(url)
		}
	});
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	clearInvestigationReturn();
	if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
	vi.restoreAllMocks();
});

describe('impersonateUser', () => {
	// The admin can click elsewhere while the request is in flight; the
	// investigation began where they clicked.
	it('remembers the page the start was clicked on and opens the reported route', async () => {
		network.replies.set(IMPERSONATE, () => {
			page.pathname = '/en/admin/users';
			page.search = '';
			return json(200, sessionBody);
		});
		network.replies.set(SESSION, () => json(200, sessionBody));

		await expect(
			impersonateUser('user_1', null, 'https://other.example/en/pricing?x=1')
		).resolves.toEqual({ started: true });

		expect(readInvestigationReturn()).toBe('/en/admin/support?thread=abc');
		expect(navigations).toEqual(['/en/pricing']);
	});

	it('leaves the previous target alone when the start is refused', async () => {
		writeInvestigationReturn('/en/admin/users?search=a');
		network.replies.set(IMPERSONATE, () =>
			json(403, { code: 'YOU_CANNOT_IMPERSONATE_ADMINS', message: 'You cannot impersonate admins' })
		);

		const outcome = await impersonateUser('user_1');

		expect(outcome.started).toBe(false);
		expect(readInvestigationReturn()).toBe('/en/admin/users?search=a');
		expect(navigations).toEqual([]);
	});

	// The session is already the customer's, so a stop has to know where to go
	// back to even though this start reports a failure.
	it('keeps the target when the session read after a start fails', async () => {
		network.replies.set(IMPERSONATE, () => json(200, sessionBody));
		network.replies.set(SESSION, () => json(500, { message: 'Internal Server Error' }));

		const outcome = await impersonateUser('user_1');

		expect(outcome.started).toBe(false);
		expect(readInvestigationReturn()).toBe('/en/admin/support?thread=abc');
	});

	// Keeping the old value would send this investigation back to wherever the
	// last one began.
	it('drops an older target when a started investigation cannot store its own', async () => {
		writeInvestigationReturn('/en/admin/users?search=a');
		// Each `%25` grows to `%2525` in the cookie, past its 3072-byte bound while
		// the target itself stays under its own.
		page.search = `?thread=abc&q=${'%25'.repeat(610)}`;
		network.replies.set(IMPERSONATE, () => json(200, sessionBody));
		network.replies.set(SESSION, () => json(200, sessionBody));

		await impersonateUser('user_1');

		expect(document.cookie).not.toContain(`${INVESTIGATION_RETURN_COOKIE}=`);
		expect(navigations).toEqual(['/en/app']);
	});
});

describe('canImpersonateUser', () => {
	it.each([
		['a registered customer', 'user_1', 'admin_1', true],
		['an anonymous visitor', 'anon_123', 'admin_1', false],
		['the signed-in admin', 'admin_1', 'admin_1', false],
		['an unresolved account', undefined, 'admin_1', false]
	])('decides for %s', (_label, target, viewer, expected) => {
		expect(canImpersonateUser(target, viewer)).toBe(expected);
	});
});
