import { afterEach, describe, expect, it } from 'vitest';
import {
	INVESTIGATION_RETURN_COOKIE,
	adminReturnTarget,
	clearInvestigationReturn,
	readInvestigationReturn,
	writeInvestigationReturn
} from './investigation-return';

const PAIR_LIMIT = 3072;

/** The `name=value` pair the browser actually holds, as a script reads it back. */
function heldPair(): string | undefined {
	return document.cookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${INVESTIGATION_RETURN_COOKIE}=`));
}

/** A support URL whose escaped cookie pair is exactly `pairBytes` long. */
function supportUrlWithPair(pairBytes: number): string {
	const prefix = '/en/admin/support?q=';
	// `%25` grows to `%2525` when encoded, so it reaches the pair limit without
	// the target itself crossing its own, smaller one.
	const escapes = 600;
	const fixed = `${INVESTIGATION_RETURN_COOKIE}=`.length + encodeURIComponent(prefix).length;
	const padding = pairBytes - fixed - escapes * '%2525'.length;
	return `${prefix}${'%25'.repeat(escapes)}${'a'.repeat(padding)}`;
}

afterEach(() => {
	clearInvestigationReturn();
});

describe('adminReturnTarget', () => {
	it('accepts an admin page with its query', () => {
		expect(adminReturnTarget('/en/admin/support?thread=abc')).toBe('/en/admin/support?thread=abc');
		expect(adminReturnTarget('/de/admin')).toBe('/de/admin');
	});

	it('drops the fragment', () => {
		expect(adminReturnTarget('/en/admin/users?search=a#row-3')).toBe('/en/admin/users?search=a');
	});

	it.each([
		['the app', '/en/app'],
		['a scheme-relative URL', '//evil.example/admin'],
		['an absolute URL', 'https://evil.example/en/admin'],
		['an unsupported language', '/zz/admin'],
		['a backslash path', '/en/admin\\..\\app'],
		['a backslash authority', '/\\evil.example/en/admin'],
		['a raw control character', '/en/admin/support?thread=a\nb'],
		['an encoded control character', '/en/admin/support?thread=a%0Ab'],
		['a path that only starts like admin', '/en/administrator'],
		['an empty value', ''],
		['no value', null]
	])('rejects %s', (_label, value) => {
		expect(adminReturnTarget(value)).toBeNull();
	});

	it('rejects a target past 2048 bytes', () => {
		const prefix = '/en/admin/support?q=';
		expect(adminReturnTarget(`${prefix}${'a'.repeat(2048 - prefix.length)}`)).not.toBeNull();
		expect(adminReturnTarget(`${prefix}${'a'.repeat(2049 - prefix.length)}`)).toBeNull();
	});
});

describe('investigation return cookie', () => {
	it('reads back what a start wrote, without consuming it', () => {
		writeInvestigationReturn('/en/admin/support?thread=abc');
		expect(readInvestigationReturn()).toBe('/en/admin/support?thread=abc');
		expect(readInvestigationReturn()).toBe('/en/admin/support?thread=abc');
	});

	it('keeps semicolons, equals signs and escapes in the query intact', () => {
		const target = '/en/admin/support?thread=abc&note=a;b=c&escaped=%3B%3D%25&space=a%20b';
		writeInvestigationReturn(target);
		expect(heldPair()).toBe(`${INVESTIGATION_RETURN_COOKIE}=${encodeURIComponent(target)}`);
		expect(readInvestigationReturn()).toBe(target);
	});

	it('stores a target whose pair is exactly at the limit', () => {
		const target = supportUrlWithPair(PAIR_LIMIT);
		expect(new TextEncoder().encode(target).length).toBeLessThanOrEqual(2048);
		writeInvestigationReturn(target);
		expect(heldPair()?.length).toBe(PAIR_LIMIT);
		expect(readInvestigationReturn()).toBe(target);
	});

	it('replaces an older value with nothing when the new target is past the limit', () => {
		writeInvestigationReturn('/en/admin/users');
		const target = supportUrlWithPair(PAIR_LIMIT + 1);
		expect(adminReturnTarget(target)).toBe(target);
		writeInvestigationReturn(target);
		expect(heldPair()).toBeUndefined();
		expect(readInvestigationReturn()).toBeNull();
	});

	it('replaces an older value with nothing when the new target is not an admin page', () => {
		writeInvestigationReturn('/en/admin/users');
		writeInvestigationReturn('/en/app');
		expect(readInvestigationReturn()).toBeNull();
	});

	it('treats malformed encoding as absent', () => {
		document.cookie = `${INVESTIGATION_RETURN_COOKIE}=%E0%A4%A; Path=/`;
		expect(readInvestigationReturn()).toBeNull();
	});

	it('re-validates a value it did not write', () => {
		document.cookie = `${INVESTIGATION_RETURN_COOKIE}=${encodeURIComponent('//evil.example/admin')}; Path=/`;
		expect(readInvestigationReturn()).toBeNull();
	});

	it('clears the stored value', () => {
		writeInvestigationReturn('/en/admin/support?thread=abc');
		clearInvestigationReturn();
		expect(heldPair()).toBeUndefined();
	});
});
