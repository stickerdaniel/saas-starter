// @vitest-environment node
// jsdom's TextEncoder yields a Uint8Array from another realm, which jose
// rejects when Better Auth signs the verification token.

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';

/**
 * The rejected-OAuth-link message tells the user to sign in with their password
 * to verify the local account. Better Auth only makes that instruction true
 * when `emailVerification.sendOnSignIn` is set: with
 * `requireEmailVerification` on, the attempt is otherwise rejected with
 * `EMAIL_NOT_VERIFIED` and no new link, and the original one has usually
 * expired by the time an OAuth sign-in is attempted.
 *
 * The second test covers the other half of that path. Better Auth mints the
 * recovery link from the same `callbackURL` the caller sends for its own
 * post-sign-in redirect, and falls back to `/` when the caller sends none
 * (better-auth/dist/api/routes/sign-in.mjs). A recovery mail that lands the
 * user on the root of the site in the default locale is not the recovery this
 * flow promises, and no assertion on our own options can see that: the
 * defaulting happens inside the dependency. So the link is measured against a
 * real Better Auth instance carrying our real option blocks, with only the
 * database and the mail sink replaced.
 */

vi.mock('../_generated/api', () => ({
	components: { betterAuth: {} },
	internal: { auth: {}, emails: { send: {} } }
}));
vi.mock('../_generated/server', () => ({
	env: { SITE_URL: 'https://example.test', BETTER_AUTH_SECRET: 'test-secret' },
	query: (definition: unknown) => definition,
	mutation: (definition: unknown) => definition,
	internalMutation: (definition: unknown) => definition
}));

const CREDENTIALS = {
	name: 'Verification Probe',
	email: 'probe@example.test',
	password: 'correct-horse-battery-staple'
};

/**
 * A Better Auth instance carrying the real `emailAndPassword` and
 * `emailVerification` blocks, backed by memory instead of Convex and with the
 * mail send captured rather than dispatched.
 */
async function withCapturedVerificationMail() {
	const { createAuthOptions } = await import('../auth');
	const options = createAuthOptions({} as never);
	const sentUrls: string[] = [];

	const auth = betterAuth({
		baseURL: 'https://example.test',
		secret: 'test-secret-that-is-long-enough-for-signing',
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		emailAndPassword: {
			...options.emailAndPassword,
			sendResetPassword: async () => {}
		},
		emailVerification: {
			...options.emailVerification,
			sendVerificationEmail: async ({ url }: { url: string }) => {
				sentUrls.push(url);
			}
		}
	});

	await auth.api.signUpEmail({ body: CREDENTIALS });
	// Drop the sign-up mail; the recovery path is what is under test.
	sentUrls.length = 0;

	return { auth, sentUrls };
}

/** The `callbackURL` Better Auth encodes into the verification link. */
function callbackOf(verificationUrl: string): string | null {
	return new URL(verificationUrl).searchParams.get('callbackURL');
}

describe('email verification recovery', () => {
	it('sends a fresh link when an unverified account signs in with a password', async () => {
		const { createAuthOptions } = await import('../auth');
		const options = createAuthOptions({} as never);

		expect(options.emailAndPassword.requireEmailVerification).toBe(true);
		expect(options.emailVerification.sendOnSignIn).toBe(true);
	});

	it('carries the caller destination into the recovery link', async () => {
		const { auth, sentUrls } = await withCapturedVerificationMail();

		await expect(
			auth.api.signInEmail({
				body: { ...CREDENTIALS, callbackURL: '/de/app/settings' }
			})
		).rejects.toThrow();

		expect(sentUrls).toHaveLength(1);
		expect(callbackOf(sentUrls[0])).toBe('/de/app/settings');
	});

	it('falls back to the site root when the caller sends no destination', async () => {
		const { auth, sentUrls } = await withCapturedVerificationMail();

		await expect(auth.api.signInEmail({ body: CREDENTIALS })).rejects.toThrow();

		// Not an assertion about what we want, but about what Better Auth does
		// when the sign-in call omits `callbackURL`. It is why the sign-in page
		// has to pass one: this is the link the user would otherwise receive.
		expect(sentUrls).toHaveLength(1);
		expect(callbackOf(sentUrls[0])).toBe('/');
	});
});
