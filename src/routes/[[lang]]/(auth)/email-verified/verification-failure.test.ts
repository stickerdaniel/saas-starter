/**
 * This page is the destination a sign-up verification link is minted with, so
 * it is where Better Auth lands a link that did not work: `redirectOnError`
 * (better-auth/dist/api/routes/email-verification.mjs) appends the reason to
 * that same URL and redirects. Nothing else on the page can tell that apart
 * from a successful verification, because the difference is only that the
 * session never appears, and the page's own fallback waits ten seconds before
 * bouncing to sign-in without saying why. Announcing a verification that did
 * not happen is the part that has to stay fixed.
 *
 * Structural for the reason the sign-in guard next door is: the failure is a
 * plausible edit to the markup, not a state this page can be driven into
 * without a browser, and the codes themselves are asserted against a real
 * Better Auth instance in src/lib/convex/__tests__/verificationRecovery.test.ts.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	path.resolve('src/routes/[[lang]]/(auth)/email-verified/+page.svelte'),
	'utf8'
);

describe('email-verified interstitial', () => {
	it('reads the failure code Better Auth appends', () => {
		expect(source).toContain('getVerificationErrorKey(params.error)');
	});

	it('never announces success without ruling that failure out', () => {
		const successTitle = source.indexOf('auth.verification.verified_title');
		expect(successTitle, 'the success title moved or was renamed').toBeGreaterThan(-1);

		const guard = source.lastIndexOf('{#if verificationError !== null}', successTitle);
		expect(guard, 'the success title is no longer behind the failure check').toBeGreaterThan(-1);

		const closes = source.indexOf('{/if}', guard);
		expect(closes).toBeGreaterThan(successTitle);
	});
});
