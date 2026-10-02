import { beforeEach, describe, expect, it } from 'vitest';
import { clearAnalyticsIdentity, isStorageUsable, type BrowserStores } from './storage';

// Names written out by hand from the pinned SDK sources, not derived from the helper:
// posthog-persistence.ts parseName transforms the token for the main entry only.
const RAW = 'phc_a+b/c=';
const EXACT = {
	main: 'ph_phc_aPLbSLcEQ_posthog',
	windowId: 'ph_phc_a+b/c=_window_id',
	primaryWindow: 'ph_phc_a+b/c=_primary_window_exists',
	sessionRegistered: 'ph_phc_a+b/c=_session_registered_properties',
	periodStamp: 'analytics_identity_grant_phc_a+b/c=',
	consentMarker: '__ph_opt_in_out_phc_a+b/c='
};

function stores(): BrowserStores {
	return {
		localStorage,
		sessionStorage,
		document,
		hostname: 'app.example.co.uk',
		secure: false
	};
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

describe('clearAnalyticsIdentity', () => {
	it('removes exactly the identity keys of the configured project', () => {
		for (const key of [EXACT.main, EXACT.periodStamp, EXACT.consentMarker])
			localStorage.setItem(key, 'x');
		for (const key of [EXACT.main, EXACT.windowId, EXACT.primaryWindow, EXACT.sessionRegistered]) {
			sessionStorage.setItem(key, 'x');
		}
		// Neighbours that must survive: a token prefix of the configured one, another
		// project, the SDK's shared debug key, and unrelated app state.
		localStorage.setItem('ph_phc_a_posthog', 'other');
		localStorage.setItem('ph_phc_aPLbSLcEQX_posthog', 'other');
		localStorage.setItem('ph_debug', 'true');
		localStorage.setItem('theme', 'dark');
		sessionStorage.setItem('ph_phc_other_window_id', 'other');

		clearAnalyticsIdentity(RAW, stores());

		expect(Object.keys(localStorage).sort()).toEqual(
			[
				EXACT.consentMarker,
				'ph_debug',
				'ph_phc_aPLbSLcEQX_posthog',
				'ph_phc_a_posthog',
				'theme'
			].sort()
		);
		expect(Object.keys(sessionStorage)).toEqual(['ph_phc_other_window_id']);
	});

	it('expires a legacy persistence cookie from older template versions', () => {
		document.cookie = `${EXACT.main}=legacy; Path=/`;
		document.cookie = 'unrelated=keep; Path=/';

		clearAnalyticsIdentity(RAW, stores());

		expect(document.cookie).not.toContain(EXACT.main);
		expect(document.cookie).toContain('unrelated=keep');
		document.cookie = 'unrelated=; Max-Age=0; Path=/';
	});

	it('tolerates storage that throws', () => {
		const throwing = {
			removeItem() {
				throw new DOMException('blocked', 'SecurityError');
			}
		} as unknown as Storage;
		expect(() =>
			clearAnalyticsIdentity(RAW, { ...stores(), localStorage: throwing, sessionStorage: throwing })
		).not.toThrow();
	});
});

describe('isStorageUsable', () => {
	it('requires a write that reads back', () => {
		expect(isStorageUsable(() => localStorage)).toBe(true);
		expect(isStorageUsable(() => undefined)).toBe(false);
		const ignoring = { setItem() {}, getItem: () => null, removeItem() {} } as unknown as Storage;
		expect(isStorageUsable(() => ignoring)).toBe(false);
		expect(
			isStorageUsable(() => {
				throw new DOMException('blocked', 'SecurityError');
			})
		).toBe(false);
	});
});
