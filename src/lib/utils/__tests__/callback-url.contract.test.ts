// @vitest-environment node

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'vitest';
import { callbackURLFor } from '../url';

/**
 * `callbackURLFor` carries a copy of a rule that lives in Better Auth, and a
 * copied rule is a claim about the dependency rather than knowledge of it. This
 * asks the installed dependency instead: each destination goes through the real
 * HTTP handler, where the origin-check middleware sits, and the verdict is
 * compared with ours.
 *
 * The middleware only runs on a `Request`. Calling `auth.api.signInEmail`
 * directly skips it, which is why the recovery tests next door cannot see any
 * of this.
 */

const BASE = 'https://example.test';

const auth = betterAuth({
	baseURL: BASE,
	secret: 'test-secret-that-is-long-enough-for-signing',
	database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
	emailAndPassword: { enabled: true },
	// Better Auth turns its own origin check off under a test runner
	// (`isTest()` in better-auth/dist/context/create-context.mjs), so without
	// this every destination below is accepted and the comparison is vacuous.
	advanced: { disableOriginCheck: false }
});

/** Whether Better Auth accepts this value in the `callbackURL` field. */
async function betterAuthAccepts(destination: string): Promise<boolean> {
	const response = await auth.handler(
		new Request(`${BASE}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({
				email: 'nobody@example.test',
				password: 'correct-horse-battery-staple',
				callbackURL: destination
			})
		})
	);

	// Anything other than the callback rejection means the value passed the
	// middleware; the sign-in itself fails on the missing user, which is fine.
	if (response.status !== 403) return true;
	const body = (await response.json()) as { code?: string };
	return body.code !== 'INVALID_CALLBACK_URL';
}

const DESTINATIONS = [
	'/app',
	'/de/app/settings',
	'/app/settings?tab=billing',
	'/app?redirectTo=%2Fde%2Fapp',
	'/app@work',
	'/app#billing',
	'/caf%C3%A9',
	'/app/a b',
	'/app,list',
	// The six characters `encodeURIComponent` leaves alone, which is how they
	// reach a callback URL built by embedding a destination in a parameter.
	'/de/signin?redirectTo=%2Fapp!x',
	'/de/signin?redirectTo=%2Fapp~x',
	"/de/signin?redirectTo=%2Fapp'x",
	'/de/signin?redirectTo=%2Fapp(x',
	'/de/signin?redirectTo=%2Fapp)x',
	'/de/signin?redirectTo=%2Fapp*x',
	'//evil.com',
	'/\\evil.com'
];

describe('callbackURLFor against the installed Better Auth', () => {
	it.each(DESTINATIONS)('agrees with the dependency about %s', async (destination) => {
		const ours = callbackURLFor(destination, '/fallback') === destination;
		await expect(betterAuthAccepts(destination)).resolves.toBe(ours);
	});

	it('falls back rather than sending something that would be refused', () => {
		expect(callbackURLFor('/app#billing', '/de/app')).toBe('/de/app');
		expect(callbackURLFor('/de/app/settings', '/de/app')).toBe('/de/app/settings');
	});
});
