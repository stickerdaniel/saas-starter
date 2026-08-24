import type { ServerLoadEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { resolveAuthLayoutData, resolvePublicAuthLayoutData } from './auth-layout-data';
import { shouldUsePublicAuthSnapshot } from './auth-route';

// Guards the per-request memo: on a data request into an authed subtree the
// subtree layout AND any parent()-forced root layout load both resolve the
// auth block, and the memo (keyed on the request-scoped event.locals) is what
// keeps that at one Autumn call + one Convex query per request.
// Unauthenticated events (no locals.token) never touch Convex/Autumn, so
// these tests exercise the memo without any network.

function fakeEvent(locals: App.Locals, cookies: Record<string, string> = {}): ServerLoadEvent {
	return {
		locals,
		depends: vi.fn(),
		request: new Request('https://example.com/en'),
		cookies: { get: (name: string) => cookies[name] }
	} as unknown as ServerLoadEvent;
}

describe('resolveAuthLayoutData per-request memo', () => {
	it('resolves once per request when called from multiple loads', async () => {
		const locals = {} as App.Locals;
		const first = await resolveAuthLayoutData(fakeEvent(locals));
		const second = await resolveAuthLayoutData(fakeEvent(locals));
		expect(second).toBe(first);
	});

	it('resolves fresh for a new request', async () => {
		const first = await resolveAuthLayoutData(fakeEvent({} as App.Locals));
		const second = await resolveAuthLayoutData(fakeEvent({} as App.Locals));
		expect(second).not.toBe(first);
	});

	it('registers the invalidation deps on every calling load, memo hit or not', async () => {
		const locals = {} as App.Locals;
		const first = fakeEvent(locals);
		const second = fakeEvent(locals);
		await resolveAuthLayoutData(first);
		await resolveAuthLayoutData(second);
		for (const event of [first, second]) {
			expect(event.depends).toHaveBeenCalledWith('app:auth');
			expect(event.depends).toHaveBeenCalledWith('autumn:customer');
		}
	});
});

describe('public auth snapshot', () => {
	it.each([
		'/[[lang]]/(marketing)',
		'/[[lang]]/(marketing)/privacy',
		'/[[lang]]/[...path]',
		'/llms.txt',
		'/robots.txt',
		'/sitemap.xml'
	])('keeps %s independent from backend auth data', (routeId) => {
		expect(
			shouldUsePublicAuthSnapshot({ routeId, pathname: '/en/privacy', marketingMarkdown: false })
		).toBe(true);
	});

	it.each([
		'/[[lang]]/(marketing)/pricing',
		'/[[lang]]/(auth)/signin',
		'/[[lang]]/app',
		'/[[lang]]/admin',
		null
	])('keeps backend auth resolution for %s', (routeId) => {
		expect(
			shouldUsePublicAuthSnapshot({ routeId, pathname: '/en/pricing', marketingMarkdown: false })
		).toBe(false);
	});

	it('keeps pricing Markdown backend-free while pricing HTML loads billing state', () => {
		const input = {
			routeId: '/[[lang]]/(marketing)/pricing',
			pathname: '/en/pricing'
		};
		expect(shouldUsePublicAuthSnapshot({ ...input, marketingMarkdown: true })).toBe(true);
		expect(shouldUsePublicAuthSnapshot({ ...input, marketingMarkdown: false })).toBe(false);
	});

	it.each(['/en/app/missing', '/en/admin/missing'])(
		'does not treat a protected catch-all as public: %s',
		(pathname) => {
			expect(
				shouldUsePublicAuthSnapshot({
					routeId: '/[[lang]]/[...path]',
					pathname,
					marketingMarkdown: false
				})
			).toBe(false);
		}
	);

	it('returns a local unauthenticated snapshot and registers auth invalidation', () => {
		const event = fakeEvent({} as App.Locals);
		expect(resolvePublicAuthLayoutData(event)).toMatchObject({
			authState: { isAuthenticated: false, hasSession: false },
			autumnState: { customer: null },
			viewer: null
		});
		expect(event.depends).toHaveBeenCalledWith('app:auth');
		expect(event.depends).not.toHaveBeenCalledWith('autumn:customer');
	});

	it('reports a surviving Better Auth session without minting a Convex JWT', () => {
		const event = fakeEvent({} as App.Locals, {
			'__Secure-better-auth.session_token': 'session-alive'
		});
		expect(resolvePublicAuthLayoutData(event).authState).toEqual({
			isAuthenticated: false,
			hasSession: true
		});
	});

	it('derives an authenticated public snapshot from the verified JWT only', () => {
		const payload = Buffer.from(
			JSON.stringify({ sub: 'user_123', email: 'user@example.com', role: 'user' })
		).toString('base64url');
		const event = fakeEvent({ token: `header.${payload}.signature` } as App.Locals);

		expect(resolvePublicAuthLayoutData(event)).toMatchObject({
			authState: { isAuthenticated: true },
			autumnState: { customer: null },
			viewer: { _id: 'user_123', email: 'user@example.com', role: 'user' }
		});
		expect(event.depends).not.toHaveBeenCalledWith('autumn:customer');
	});
});
