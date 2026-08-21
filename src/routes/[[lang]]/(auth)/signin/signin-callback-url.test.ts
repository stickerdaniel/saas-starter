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
 * The file with its comments removed, wherever they sit. Dropping whole comment
 * lines is not enough: a trailing `/* ... *\/` on the same line as the rewritten
 * call would carry the old expression forward and the search would find it
 * there.
 *
 * `//` is only treated as a comment at the start of a line or after whitespace,
 * which is what keeps the `//` of a URL. A `//` inside a string literal is
 * stripped along with the rest of that line, and that direction is the safe one:
 * it can fail a correct file, never pass a broken one.
 */
function withoutComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
		.map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
		.join('\n');
}

/**
 * All whitespace removed, so the expectations below can be written on one line
 * whatever the formatter does to the call. Prettier split this very call across
 * four lines the moment it grew an argument, and padded the brackets while it
 * was there; the guard went red over the layout alone. Nothing asserted here
 * contains a meaningful space, so dropping every one of them is safe and needs
 * no rule about where the formatter is allowed to break.
 */
function normalized(text: string): string {
	return text.replace(/\s+/g, '');
}

const source = normalized(
	withoutComments(
		readFileSync(path.resolve('src/routes/[[lang]]/(auth)/signin/+page.svelte'), 'utf8')
	)
);

const DESTINATION = "safeAuthDestination(params.redirectTo, localizedHref('/app'))";

/**
 * Better Auth applies its own, stricter relative-path rule to `callbackURL`,
 * so the destination is narrowed again before it is sent. The navigation below
 * is ours and keeps the full value.
 */
const CALLBACK = `callbackURLFor(${DESTINATION}, localizedHref('/app'))`;

describe('password sign-in callback URL', () => {
	it('sends the destination Better Auth needs for the recovery link', () => {
		const callStart = source.indexOf(normalized('authClient.signIn.email('));
		expect(callStart, 'the sign-in call moved or was renamed').toBeGreaterThan(-1);

		const callEnd = source.indexOf(normalized('if (!failed)'), callStart);
		expect(callEnd, 'the success branch moved; the slice below is unbounded').toBeGreaterThan(-1);

		expect(source.slice(callStart, callEnd)).toContain(normalized(`callbackURL: ${CALLBACK}`));
	});

	it('agrees with the redirect the page performs itself', () => {
		expect(source).toContain(normalized(`window.location.href = ${DESTINATION};`));
	});

	/**
	 * The server keeps a signed-in visitor on this page when a verification link
	 * failed, because this is the only page that reports one. Hydration reaches
	 * the authenticated-redirect effect within milliseconds of the first paint,
	 * so an ungated effect renders the message and navigates away from it, and
	 * the hold buys nothing for any browser that runs JavaScript. Structural for
	 * the same reason as the guard above: the failure is a plausible edit to one
	 * condition rather than a state the flow can be driven into from a test.
	 */
	it('does not navigate away from a failure it was held to report', () => {
		expect(source).toContain(
			normalized('if (auth.isAuthenticated && !heldForVerificationFailure) {')
		);

		// The condition is only worth as much as what it reads. `false`, or a read
		// of the query after the effect below has cleared it, both leave the guard
		// looking exactly like this and put the redirect back.
		expect(source).toContain(
			normalized(
				'const heldForVerificationFailure = initialVerificationCode !== null && auth.isAuthenticated;'
			)
		);
		expect(source).toContain(
			normalized('const initialVerificationCode = verificationErrorIn(page.url.searchParams);')
		);
	});

	/**
	 * Nothing else redirects for a held visitor, so every path that authenticates
	 * on this page has to say so itself. Password sign-in and passkey both do;
	 * social sign-in leaves through the provider and never returns here.
	 */
	it('lets a held visitor through once they authenticate here', () => {
		const passkey = source.indexOf(normalized('async function handlePasskeyLogin('));
		expect(passkey, 'the passkey handler moved or was renamed').toBeGreaterThan(-1);
		expect(source.slice(passkey)).toContain(normalized('redirectAfterAuthentication();'));
	});
});
