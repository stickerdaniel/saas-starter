import { describe, expect, it } from 'vitest';
import { normalizeSupportPageRoute, SUPPORT_PAGE_ROUTE_MAX_BYTES } from './support-page-route';

describe('normalizeSupportPageRoute', () => {
	it.each([
		['https://example.com/de/app?panel=details#message', '/de/app'],
		['http://example.com/fr/app/projects/p1?tab=files', '/fr/app/projects/p1'],
		['/es/app?panel=details#message', '/es/app'],
		['/', '/']
	])('keeps only the pathname from %s', (value, expected) => {
		expect(normalizeSupportPageRoute(value)).toBe(expected);
	});

	it.each([
		undefined,
		'',
		'app/projects/p1',
		'//evil.example/phish',
		'javascript:alert(1)',
		'data:text/html,phish',
		'https://',
		'/safe\\evil'
	])('omits unsafe or invalid metadata %s', (value) => {
		expect(normalizeSupportPageRoute(value)).toBeUndefined();
	});

	it('measures the input in UTF-8 bytes', () => {
		const route = `/de/${'ü'.repeat(SUPPORT_PAGE_ROUTE_MAX_BYTES / 2)}`;

		expect(route.length).toBeLessThan(SUPPORT_PAGE_ROUTE_MAX_BYTES);
		expect(normalizeSupportPageRoute(route)).toBeUndefined();
	});

	it('also bounds the encoded pathname produced by URL parsing', () => {
		const route = `/de/${'ü'.repeat(500)}`;

		expect(new TextEncoder().encode(route).byteLength).toBeLessThan(SUPPORT_PAGE_ROUTE_MAX_BYTES);
		expect(normalizeSupportPageRoute(route)).toBeUndefined();
	});
});
