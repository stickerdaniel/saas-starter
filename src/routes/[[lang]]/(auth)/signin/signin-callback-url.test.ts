/**
 * `callbackURL` on `signIn.email` is read twice by Better Auth, and the two
 * readings pull in opposite directions.
 *
 * On the rejection path it is the destination baked into the fresh
 * verification link (better-auth/dist/api/routes/sign-in.mjs, which falls back
 * to `/`), so it has to carry the locale and the pending `redirectTo`. On the
 * success path the client `redirectPlugin`
 * (better-auth/dist/client/fetch-plugins.mjs) navigates to it unconditionally,
 * because `isSafeUrlScheme` waves relative paths through. The signup page sends
 * the `/email-verified` interstitial, and copying that here for symmetry would
 * route every successful password sign-in through a page announcing an email
 * verification that did not happen.
 *
 * The one value that satisfies both is the final destination the page already
 * navigates to itself, so the guard is that the two expressions stay the same
 * expression. Structural because the failure is a plausible edit to one line,
 * not a state the sign-in flow can be driven into: the redirect it produces is
 * a full page load in the browser, and the link it produces is asserted
 * against a real Better Auth instance in
 * src/lib/convex/__tests__/verificationRecovery.test.ts.
 *
 * Comments are dropped first, because the cheapest way to make a text search
 * lie is to leave the old line behind as prose while the real call moves on.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The file with its comment lines removed. Line-based rather than a regex over
 * the whole text, so a `//` inside a URL or a `/*` inside a string survives.
 */
function withoutComments(text: string): string {
	return text
		.split('\n')
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith('//') ||
				trimmed.startsWith('/*') ||
				trimmed.startsWith('*') ||
				trimmed.startsWith('<!--')
			);
		})
		.join('\n');
}

const source = withoutComments(
	readFileSync(path.resolve('src/routes/[[lang]]/(auth)/signin/+page.svelte'), 'utf8')
);

const DESTINATION = "safeRedirectPath(params.redirectTo, localizedHref('/app'))";

describe('password sign-in callback URL', () => {
	it('sends the destination Better Auth needs for the recovery link', () => {
		const callStart = source.indexOf('authClient.signIn.email(');
		expect(callStart, 'the sign-in call moved or was renamed').toBeGreaterThan(-1);

		const callEnd = source.indexOf('if (!failed)', callStart);
		expect(callEnd, 'the success branch moved; the slice below is unbounded').toBeGreaterThan(-1);

		expect(source.slice(callStart, callEnd)).toContain(`callbackURL: ${DESTINATION}`);
	});

	it('agrees with the redirect the page performs itself', () => {
		expect(source).toContain(`window.location.href = ${DESTINATION};`);
	});
});
