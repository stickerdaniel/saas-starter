import type { ServerLoadEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { resolveAuthLayoutData } from './auth-layout-data';

// Guards the per-request memo: on a data request into an authed subtree the
// subtree layout AND any parent()-forced root layout load both resolve the
// auth block, and the memo (keyed on the request-scoped event.locals) is what
// keeps that at one Autumn call + one Convex query per request.
// Unauthenticated events (no locals.token) never touch Convex/Autumn, so
// these tests exercise the memo without any network.

function fakeEvent(locals: App.Locals): ServerLoadEvent {
	return { locals, depends: vi.fn() } as unknown as ServerLoadEvent;
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
