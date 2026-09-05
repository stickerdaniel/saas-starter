// @vitest-environment node

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { beforeAll, describe, expect, it } from 'vitest';
import { authPageURL, callbackURLFor } from '../url';

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

/**
 * Der Recovery-Durchlauf gegen denselben echten Handler.
 *
 * Der Reset-Callback muss zwei getrennte Prüfungen überstehen: `redirectTo` beim
 * Anfordern und `callbackURL` beim Öffnen des Links (`originCheck` auf
 * `/request-password-reset` und `/reset-password/:token` in
 * better-auth/dist/api/routes/password.mjs). Ob der Wrapper akzeptiert wird,
 * kann nur die Dependency selbst beantworten.
 *
 * Die Mail wird bei `sendResetPassword` abgegriffen statt versendet: kein
 * Transport und keine Adresse, die etwas empfangen könnte.
 */
const RECOVERY_EMAIL = 'recovery@example.test';
const RECOVERY_PASSWORD = 'correct-horse-battery-staple';
const RECOVERY_DESTINATION = '/de/app/settings?tab=profile#section';

let resetEmailURL = '';

const recoveryAuth = betterAuth({
	baseURL: BASE,
	secret: 'test-secret-that-is-long-enough-for-signing',
	database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
	emailAndPassword: {
		enabled: true,
		sendResetPassword: async ({ url }) => {
			resetEmailURL = url;
		}
	},
	advanced: { disableOriginCheck: false }
});

/** Das `redirectTo` einer URL, wie die Zielseite es lesen würde. */
function carriedDestination(url: string): string | null {
	return new URL(url, BASE).searchParams.get('redirectTo');
}

describe('the reset callback authPageURL builds', () => {
	const resetCallback = authPageURL('/de/reset-password', RECOVERY_DESTINATION);

	beforeAll(async () => {
		const signUp = await recoveryAuth.handler(
			new Request(`${BASE}/api/auth/sign-up/email`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: BASE },
				body: JSON.stringify({
					email: RECOVERY_EMAIL,
					password: RECOVERY_PASSWORD,
					name: 'Recovery Contract'
				})
			})
		);
		expect(signUp.status, await signUp.text()).toBe(200);

		const requested = await recoveryAuth.handler(
			new Request(`${BASE}/api/auth/request-password-reset`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: BASE },
				body: JSON.stringify({ email: RECOVERY_EMAIL, redirectTo: resetCallback })
			})
		);
		// Ein abgelehntes `redirectTo` wäre hier ein 403, also genau der Fehler,
		// den der Wrapper verhindern soll.
		expect(requested.status, await requested.text()).toBe(200);
	});

	it('is the callback the dependency puts in the mail', () => {
		expect(resetEmailURL).not.toBe('');
		expect(new URL(resetEmailURL).searchParams.get('callbackURL')).toBe(resetCallback);
	});

	it('sends a valid link on to the reset form with token and destination', async () => {
		const response = await recoveryAuth.handler(new Request(resetEmailURL));
		expect(response.status).toBe(302);

		const location = new URL(response.headers.get('location')!);
		expect(location.pathname).toBe('/de/reset-password');
		expect(location.searchParams.get('token')).toBeTruthy();
		expect(carriedDestination(location.href)).toBe(RECOVERY_DESTINATION);
	});

	it('reports a rejected link on the same page, still carrying the destination', async () => {
		const rejected = new URL(resetEmailURL);
		rejected.pathname = rejected.pathname.replace(/[^/]+$/, 'not-a-real-token');

		const response = await recoveryAuth.handler(new Request(rejected));
		expect(response.status).toBe(302);

		const location = new URL(response.headers.get('location')!);
		expect(location.pathname).toBe('/de/reset-password');
		expect(location.searchParams.get('error')).toBe('INVALID_TOKEN');
		// Kein Token: deshalb muss der Hook diese Seite auswickeln, statt sie das
		// Ende der Reise sein zu lassen.
		expect(location.searchParams.get('token')).toBeNull();
		expect(carriedDestination(location.href)).toBe(RECOVERY_DESTINATION);
	});
});
