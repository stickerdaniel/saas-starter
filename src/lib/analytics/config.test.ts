import { describe, expect, it } from 'vitest';
import { parseAllowedHosts, parseApiHost, resolveAnalyticsConfig } from './config';

const env = {
	apiKey: 'phc_test',
	apiHost: 'https://eu.i.posthog.com',
	allowedHosts: 'example.com, www.example.com'
};

describe('resolveAnalyticsConfig', () => {
	it('enables analytics on an exactly allowed hostname', () => {
		expect(resolveAnalyticsConfig(env, 'www.example.com')).toEqual({
			enabled: true,
			apiKey: 'phc_test',
			apiHost: 'https://eu.i.posthog.com',
			uiHost: 'https://eu.posthog.com'
		});
		expect(resolveAnalyticsConfig(env, 'EXAMPLE.com').enabled).toBe(true);
	});

	it('stays off on hostnames that only contain an allowed one', () => {
		for (const hostname of ['evil-example.com', 'example.com.evil.test', 'preview.example.com']) {
			expect(resolveAnalyticsConfig(env, hostname)).toEqual({
				enabled: false,
				reason: 'host_not_allowed'
			});
		}
	});

	it('stays off when the allowlist is missing or only malformed', () => {
		for (const allowedHosts of [
			undefined,
			'',
			'*.example.com',
			'example.com:443',
			'https://example.com'
		]) {
			expect(resolveAnalyticsConfig({ ...env, allowedHosts }, 'example.com').enabled).toBe(false);
		}
	});

	it('stays off without a key or host, or with an unusable ingestion URL', () => {
		expect(resolveAnalyticsConfig({ ...env, apiKey: ' ' }, 'example.com')).toEqual({
			enabled: false,
			reason: 'unconfigured'
		});
		for (const apiHost of [
			'http://eu.i.posthog.com',
			'https://user:pass@eu.i.posthog.com',
			'https://e.example.com/ingest',
			'https://e.example.com/?token=x',
			'not a url'
		]) {
			expect(resolveAnalyticsConfig({ ...env, apiHost }, 'example.com')).toEqual({
				enabled: false,
				reason: 'invalid_host'
			});
		}
	});

	it('derives the UI host for PostHog Cloud regions only', () => {
		const us = resolveAnalyticsConfig(
			{ ...env, apiHost: 'https://us.i.posthog.com' },
			'example.com'
		);
		const proxy = resolveAnalyticsConfig(
			{ ...env, apiHost: 'https://e.example.com' },
			'example.com'
		);
		expect(us.enabled && us.uiHost).toBe('https://us.posthog.com');
		expect(proxy.enabled && proxy.uiHost).toBeUndefined();
	});
});

describe('parseAllowedHosts', () => {
	it('keeps exact hostnames and drops everything else', () => {
		expect([...parseAllowedHosts(' Example.com ,localhost,bad host,a.b.c:80, *.x.io ')]).toEqual([
			'example.com',
			'localhost'
		]);
	});
});

describe('parseApiHost', () => {
	it('allows plain http only for local hostnames', () => {
		expect(parseApiHost('http://localhost:8010')).toBe('http://localhost:8010');
		expect(parseApiHost('https://e.example.com/')).toBe('https://e.example.com');
	});
});
