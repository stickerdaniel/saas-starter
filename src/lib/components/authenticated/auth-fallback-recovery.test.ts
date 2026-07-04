import { describe, it, expect } from 'vitest';
import { shouldAutoReload } from './auth-fallback-recovery';

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
