import { describe, expect, it } from 'vitest';
import {
	CONSENT_LIFETIME_SECONDS,
	createGrantId,
	denyCookie,
	grantCookie,
	parseConsentCookie
} from './consent';

const NOW = 1_800_000_000;
const GRANT = 'AbCdEfGhIjKlMnOpQrStUv';

function valueOf(setCookie: string): string {
	return setCookie.split(';')[0] ?? '';
}

describe('consent cookie', () => {
	it('round-trips a grant with its period and expiry', () => {
		const cookie = grantCookie(GRANT, NOW, true);
		expect(parseConsentCookie(`theme=dark; ${valueOf(cookie)}`, NOW)).toEqual({
			status: 'granted',
			grantId: GRANT,
			expiresAt: NOW + CONSENT_LIFETIME_SECONDS
		});
		expect(cookie).toContain(`Max-Age=${CONSENT_LIFETIME_SECONDS}`);
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).toContain('Secure');
		expect(grantCookie(GRANT, NOW, false)).not.toContain('Secure');
	});

	it('round-trips a refusal', () => {
		expect(parseConsentCookie(valueOf(denyCookie(false)), NOW)).toEqual({ status: 'denied' });
	});

	it('treats an expired grant as pending', () => {
		const cookie = valueOf(grantCookie(GRANT, NOW, false));
		expect(parseConsentCookie(cookie, NOW + CONSENT_LIFETIME_SECONDS)).toEqual({
			status: 'pending'
		});
		expect(parseConsentCookie(cookie, NOW + CONSENT_LIFETIME_SECONDS - 1).status).toBe('granted');
	});

	it('treats missing, unknown, malformed and conflicting values as pending', () => {
		for (const header of [
			'',
			'analytics_consent=granted',
			'analytics_consent=v2.granted.AbCdEfGhIjKlMnOpQrStUv.1800000100',
			'analytics_consent=v1.granted.short.1800000100',
			'analytics_consent=v1.granted.AbCdEfGhIjKlMnOpQrStUv.notanumber',
			'analytics_consent=v1.denied; analytics_consent=v1.granted.AbCdEfGhIjKlMnOpQrStUv.1900000000',
			'xanalytics_consent=v1.denied'
		]) {
			expect(parseConsentCookie(header, NOW)).toEqual({ status: 'pending' });
		}
	});

	it('accepts the same value sent twice', () => {
		expect(
			parseConsentCookie('analytics_consent=v1.denied; analytics_consent=v1.denied', NOW)
		).toEqual({
			status: 'denied'
		});
	});

	it('creates grant ids that parse and differ', () => {
		const first = createGrantId();
		expect(parseConsentCookie(valueOf(grantCookie(first, NOW, false)), NOW)).toMatchObject({
			grantId: first
		});
		expect(createGrantId()).not.toBe(first);
	});
});
