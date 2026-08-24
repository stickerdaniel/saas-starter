import { describe, expect, it } from 'vitest';
import { shouldShowMarketingAuthControls } from './marketing-auth-controls';

describe('marketing auth controls', () => {
	it('shows controls immediately when SSR authenticated the visitor', () => {
		expect(
			shouldShowMarketingAuthControls({
				ssrAuthenticated: true,
				ssrHasSession: true,
				sessionChecked: false,
				authLoading: true
			})
		).toBe(true);
	});

	it('shows signed-out controls immediately when no session exists', () => {
		expect(
			shouldShowMarketingAuthControls({
				ssrAuthenticated: false,
				ssrHasSession: false,
				sessionChecked: false,
				authLoading: true
			})
		).toBe(true);
	});

	it('hides controls while a surviving session is still being checked', () => {
		expect(
			shouldShowMarketingAuthControls({
				ssrAuthenticated: false,
				ssrHasSession: true,
				sessionChecked: false,
				authLoading: true
			})
		).toBe(false);
	});

	it('shows the resolved controls after the session check finishes', () => {
		expect(
			shouldShowMarketingAuthControls({
				ssrAuthenticated: false,
				ssrHasSession: true,
				sessionChecked: true,
				authLoading: false
			})
		).toBe(true);
	});
});
