import { describe, expect, it } from 'vitest';
import { consentDestination } from './consent-destination';

const destinationOf = (redirectUri: string) =>
	consentDestination(new URLSearchParams({ redirect_uri: redirectUri }));

describe('consentDestination', () => {
	it('names the host of a hosted redirect URI', () => {
		expect(destinationOf('https://claude.ai/api/mcp/auth_callback')).toEqual({
			kind: 'hosted',
			host: 'claude.ai'
		});
		expect(destinationOf('https://app.example.com:8443/callback')).toEqual({
			kind: 'hosted',
			host: 'app.example.com:8443'
		});
		expect(destinationOf('https://bücher.example/callback')).toEqual({
			kind: 'hosted',
			host: 'xn--bcher-kva.example'
		});
	});

	it('names an app on this device for loopback hosts and custom schemes', () => {
		for (const redirectUri of [
			'http://127.0.0.1:43111/callback',
			'http://127.8.9.10/callback',
			'http://[::1]:43111/callback',
			'http://localhost:3000/callback',
			'cursor://anysphere.cursor-mcp/oauth/callback'
		]) {
			expect(destinationOf(redirectUri), redirectUri).toEqual({ kind: 'device' });
		}
	});

	it('knows no destination without a parsable redirect URI', () => {
		expect(consentDestination(new URLSearchParams({ client_id: 'client' }))).toEqual({
			kind: 'unknown'
		});
		expect(destinationOf('not a url')).toEqual({ kind: 'unknown' });
	});

	it('knows no destination for a scheme that a website can register a handler for', () => {
		for (const redirectUri of [
			'web+app://callback.example/oauth',
			'matrix://callback.example/oauth'
		]) {
			expect(destinationOf(redirectUri), redirectUri).toEqual({ kind: 'unknown' });
		}
	});
});
