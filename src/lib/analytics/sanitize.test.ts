import type { CaptureResult } from 'posthog-js';
import { describe, expect, it } from 'vitest';
import { sanitizeCaptureResult, sanitizeUrl, type SanitizeContext } from './sanitize';

const context: SanitizeContext = { epochHasPageview: true };

// Key names as the pinned SDK emits them (see posthog-sdk.contract.test.ts).
function pageview(overrides: Partial<CaptureResult['properties']> = {}): CaptureResult {
	return {
		uuid: 'event-1',
		event: '$pageview',
		properties: {
			$current_url:
				'https://user:pw@app.test/en/reset-password?token=SECRET&other=OTHER&utm_source=gh#frag',
			$host: 'app.test',
			$pathname: '/en/reset-password',
			$referrer: 'https://www.google.com/search?q=SEARCH',
			$referring_domain: 'www.google.com',
			$search_engine: 'google',
			ph_keyword: 'SEARCH',
			utm_source: 'gh',
			utm_medium: 'person@example.test',
			utm_campaign: 'x'.repeat(101),
			gclid: 'CLICK',
			gad_source: '1',
			title: 'Reset password',
			$session_entry_url: 'https://app.test/en?q=SEARCH&utm_campaign=launch',
			$session_entry_referrer: 'https://news.example/item?id=7',
			$session_entry_utm_source: 'gh',
			$session_entry_ph_keyword: 'SEARCH',
			$prev_pageview_pathname: '/en/jane-doe',
			$pageview_id: 'pv-2',
			$set_once: {
				$initial_current_url: 'https://app.test/en/jane-doe?utm_source=gh',
				$initial_referrer: '$direct',
				$initial_pathname: '/en/jane-doe',
				$initial_utm_source: 'gh',
				$initial_utm_medium: 'bad@value',
				$initial_ph_keyword: 'SEARCH',
				$initial_gclid: 'CLICK'
			},
			...overrides
		}
	};
}

describe('sanitizeCaptureResult', () => {
	it('removes every secret, search term and click id from a real-shaped pageview', () => {
		const result = sanitizeCaptureResult(pageview(), context);
		const body = JSON.stringify(result);
		for (const sentinel of [
			'SECRET',
			'OTHER',
			'SEARCH',
			'frag',
			'CLICK',
			'person@',
			'bad@',
			'user:pw',
			'jane-doe',
			'id=7'
		]) {
			expect(body).not.toContain(sentinel);
		}
		expect(result.properties).not.toHaveProperty('title');
		expect(result.properties).not.toHaveProperty('gad_source');
		expect(result.properties).not.toHaveProperty('utm_campaign');
	});

	it('keeps the data web analytics needs', () => {
		const { properties } = sanitizeCaptureResult(pageview(), context);
		expect(properties.$current_url).toBe('https://app.test/en/reset-password?utm_source=gh');
		expect(properties.$pathname).toBe('/en/reset-password');
		expect(properties.$referrer).toBe('https://www.google.com');
		expect(properties.$referring_domain).toBe('www.google.com');
		expect(properties.$search_engine).toBe('google');
		expect(properties.utm_source).toBe('gh');
		expect(properties.$session_entry_url).toBe('https://app.test/en?utm_campaign=launch');
		expect(properties.$session_entry_referrer).toBe('https://news.example');
		expect(properties.$session_entry_utm_source).toBe('gh');
		expect(properties.$prev_pageview_pathname).toBe('/404');
		expect(properties.$set_once).toEqual({
			$initial_current_url: 'https://app.test/404?utm_source=gh',
			$initial_referrer: '$direct',
			$initial_pathname: '/404',
			$initial_utm_source: 'gh'
		});
	});

	it('sanitizes top-level person property containers too', () => {
		const result = sanitizeCaptureResult(
			{
				uuid: 'event-2',
				event: '$set',
				properties: {},
				$set: { $current_url: 'https://app.test/?token=SECRET', utm_term: 'ok term' },
				$set_once: { $initial_referrer: 'https://www.google.com/search?q=SEARCH' }
			},
			context
		);
		expect(result.$set).toEqual({ $current_url: 'https://app.test/', utm_term: 'ok term' });
		expect(result.$set_once).toEqual({ $initial_referrer: 'https://www.google.com' });
	});

	it('drops URL-shaped properties it cannot parse', () => {
		const { properties } = sanitizeCaptureResult(
			pageview({ $current_url: '/relative?token=SECRET', $referrer: 'javascript:alert(1)' }),
			context
		);
		expect(properties).not.toHaveProperty('$current_url');
		expect(properties).not.toHaveProperty('$referrer');
	});

	it('cuts the links to pageviews from before the current period', () => {
		const fresh = { epochHasPageview: false };
		const first = sanitizeCaptureResult(pageview(), fresh).properties;
		expect(Object.keys(first).filter((key) => key.startsWith('$prev_pageview_'))).toEqual([]);
		expect(first.$pageview_id).toBe('pv-2');

		const identify = sanitizeCaptureResult(
			{ uuid: 'event-3', event: '$identify', properties: { $pageview_id: 'pv-old' } },
			fresh
		);
		expect(identify.properties).not.toHaveProperty('$pageview_id');
	});
});

describe('sanitizeUrl', () => {
	it('keeps only bounded UTM values', () => {
		expect(
			sanitizeUrl('https://app.test/pricing?utm_source=github&utm_content=a%20b&utm_term=%3Cx%3E')
		).toBe('https://app.test/pricing?utm_source=github&utm_content=a+b');
	});
});
