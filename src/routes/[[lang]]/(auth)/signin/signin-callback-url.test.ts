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
 * The value that satisfies both is this page carrying the destination, so the
 * guard is that both readings and the page's own navigation stay pinned to one
 * destination expression. Structural because the failure is a plausible edit to
 * one line, not a state the sign-in flow can be driven into: the redirect it
 * produces is a full page load in the browser, and the link it produces is
 * asserted against a real Better Auth instance in
 * src/lib/convex/__tests__/verificationRecovery.test.ts and
 * src/lib/utils/__tests__/callback-url.contract.test.ts.
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

const DESTINATION = 'finalDestination';

/**
 * Better Auth applies its own, stricter relative-path rule to `callbackURL`,
 * and it takes no fragment, so the destination travels inside the query of a
 * page path that does satisfy the rule. The navigation below is ours and keeps
 * the full value.
 */
const CALLBACK = `authPageURL(localizedHref('/signin'), ${DESTINATION})`;

describe('password sign-in callback URL', () => {
	it('sends the destination Better Auth needs for the recovery link', () => {
		const callStart = source.indexOf(normalized('authClient.signIn.email('));
		expect(callStart, 'the sign-in call moved or was renamed').toBeGreaterThan(-1);

		const callEnd = source.indexOf(normalized('if (!failed)'), callStart);
		expect(callEnd, 'the success branch moved; the slice below is unbounded').toBeGreaterThan(-1);

		expect(source.slice(callStart, callEnd)).toContain(normalized(`callbackURL: ${CALLBACK}`));
	});

	/**
	 * Social-Sign-in kehrt zum Callback zurück, nicht zu dieser Seite, hat also
	 * keine zweite Chance zu navigieren. Der E2E-Lauf meldet ein verifiziertes
	 * Konto per Passwort an und erreicht diesen Pfad nie.
	 */
	it('brings a social sign-in back through the same wrapper', () => {
		const callStart = source.indexOf(normalized('authClient.signIn.social('));
		expect(callStart, 'the social sign-in call moved or was renamed').toBeGreaterThan(-1);

		const callEnd = source.indexOf(normalized('} catch (error) {'), callStart);
		expect(callEnd, 'the catch moved; the slice below is unbounded').toBeGreaterThan(-1);

		expect(source.slice(callStart, callEnd)).toContain(normalized(`callbackURL: ${CALLBACK}`));
	});

	/**
	 * Für die Fehler-URL gilt absichtlich die weitere Prüfung: der Wert ist
	 * Beifahrer in einer selbst gewählten Seite, und die Seite verengt ihn beim
	 * Navigieren erneut. Doppelt verengt verlöre man nur funktionierende Links.
	 */
	it('keeps the OAuth failure URL on the unnarrowed value', () => {
		expect(source).toContain(
			normalized(
				"errorCallbackURL: oauthErrorCallbackURL(localizedHref('/signin'), rawDestination)"
			)
		);
	});

	it('agrees with the redirect the page performs itself', () => {
		expect(source).toContain(normalized(`window.location.href = ${DESTINATION};`));
	});

	/**
	 * Woran der Name hängt. Aus `params` gelesen sähe die Zeile gleich aus, aber
	 * dessen Cache füllt sich nur im Browser: die Links dieser Seite gingen dann
	 * ohne Ziel raus und blieben so, wo Hydration nie ankommt.
	 */
	it('reads the destination from the page URL, not from the params cache', () => {
		expect(source).toContain(
			normalized("const rawDestination = $derived(page.url.searchParams.get('redirectTo') ?? '');")
		);
		expect(source).toContain(
			normalized("const requestedDestination = $derived(safeAuthDestination(rawDestination, ''));")
		);
		expect(source).toContain(
			normalized(
				"const finalDestination = $derived(requestedDestination || localizedHref('/app'));"
			)
		);
	});

	/**
	 * Das Formular rendert die Links und bekommt den verengten Wert: ein Ziel, das
	 * diese Seite nicht anfahren würde, gehört auch in keinen Link.
	 */
	it('gives the form the destination it validated', () => {
		expect(source).toContain(normalized('redirectTo={requestedDestination}'));
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
