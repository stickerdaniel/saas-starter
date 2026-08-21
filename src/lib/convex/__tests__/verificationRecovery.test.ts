import { describe, expect, it, vi } from 'vitest';

/**
 * The rejected-OAuth-link message tells the user to sign in with their password
 * to verify the local account. Better Auth only makes that instruction true
 * when `emailVerification.sendOnSignIn` is set: with
 * `requireEmailVerification` on, the attempt is otherwise rejected with
 * `EMAIL_NOT_VERIFIED` and no new link, and the original one has usually
 * expired by the time an OAuth sign-in is attempted.
 *
 * Both options are asserted together because either one alone leaves the
 * documented recovery path broken.
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

describe('email verification recovery', () => {
	it('sends a fresh link when an unverified account signs in with a password', async () => {
		const { createAuthOptions } = await import('../auth');
		const options = createAuthOptions({} as never);

		expect(options.emailAndPassword.requireEmailVerification).toBe(true);
		expect(options.emailVerification.sendOnSignIn).toBe(true);
	});
});
