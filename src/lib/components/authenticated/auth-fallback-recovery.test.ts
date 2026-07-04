import { beforeEach, describe, it, expect, vi } from 'vitest';
import { armReloadGuard, hasReloadGuard, shouldAutoReload } from './auth-fallback-recovery';

describe('shouldAutoReload', () => {
	it('reloads once when signed in, clock sane, and not yet reloaded', () => {
		expect(
			shouldAutoReload({ isAuthenticated: true, isSkewed: false, alreadyReloaded: false })
		).toBe(true);
	});

	it('does not reload when the client is not authenticated', () => {
		expect(
			shouldAutoReload({ isAuthenticated: false, isSkewed: false, alreadyReloaded: false })
		).toBe(false);
	});

	it('does not reload when the clock is skewed', () => {
		expect(
			shouldAutoReload({ isAuthenticated: true, isSkewed: true, alreadyReloaded: false })
		).toBe(false);
	});

	it('does not reload a second time in the same session', () => {
		expect(
			shouldAutoReload({ isAuthenticated: true, isSkewed: false, alreadyReloaded: true })
		).toBe(false);
	});
});

// The guards run inside the fallback's timeout callback, where an uncaught
// storage throw (Web Storage disabled, private-mode write quota) would kill
// the escalation to the manual error state. They must never throw and must
// fail toward "no automatic reload".
describe('reload guard storage helpers', () => {
	beforeEach(() => {
		// jsdom's Storage is proxy-backed, so prototype spies don't intercept it;
		// stub the sessionStorage global instead to simulate throwing storage.
		vi.unstubAllGlobals();
		sessionStorage.clear();
	});

	it('reports no guard in a fresh session and a set guard after arming', () => {
		expect(hasReloadGuard()).toBe(false);
		expect(armReloadGuard()).toBe(true);
		expect(hasReloadGuard()).toBe(true);
	});

	it('treats unreadable storage as already reloaded instead of throwing', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => {
				throw new Error('storage disabled');
			}
		});
		expect(hasReloadGuard()).toBe(true);
	});

	it('reports arming failure instead of throwing when the guard cannot persist', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('quota exceeded');
			}
		});
		expect(armReloadGuard()).toBe(false);
	});
});
