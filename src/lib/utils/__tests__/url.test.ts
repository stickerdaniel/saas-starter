import { describe, expect, it } from 'vitest';
import {
	authPageURL,
	callbackURLFor,
	oauthErrorCallbackURL,
	safeAuthDestination,
	safeRedirectPath,
	splitDestinationError
} from '../url';

describe('safeRedirectPath', () => {
	it('returns a valid relative path unchanged', () => {
		expect(safeRedirectPath('/dashboard', '/')).toBe('/dashboard');
	});

	it('returns a valid nested path unchanged', () => {
		expect(safeRedirectPath('/app/settings', '/')).toBe('/app/settings');
	});

	it('returns a path with query params unchanged', () => {
		expect(safeRedirectPath('/app?foo=bar', '/')).toBe('/app?foo=bar');
	});

	it('preserves a same-origin query and hash', () => {
		expect(safeRedirectPath('/de/app?tab=one#profile', '/')).toBe('/de/app?tab=one#profile');
	});

	it('rejects a protocol-relative URL', () => {
		expect(safeRedirectPath('//evil.com', '/')).toBe('/');
	});

	it('rejects an absolute http URL', () => {
		expect(safeRedirectPath('http://evil.com', '/')).toBe('/');
	});

	it('rejects backslash and encoded network-path variants', () => {
		expect(safeRedirectPath('/\\evil.com', '/')).toBe('/');
		expect(safeRedirectPath('/%2f%2fevil.com', '/')).toBe('/');
		expect(safeRedirectPath('/%5c%5cevil.com', '/')).toBe('/');
	});

	it('rejects control characters and malformed escapes', () => {
		expect(safeRedirectPath('/de/app\nLocation: https://evil.test', '/')).toBe('/');
		expect(safeRedirectPath('/de/%zz', '/')).toBe('/');
	});

	it('rejects percent-encoded control characters', () => {
		expect(safeRedirectPath('/de/app%0d%0aLocation:%20https://evil.test', '/')).toBe('/');
		expect(safeRedirectPath('/app%09/next', '/')).toBe('/');
	});

	it('rejects encoded control chars regardless of case or position', () => {
		expect(safeRedirectPath('/app%00', '/')).toBe('/');
		expect(safeRedirectPath('/app%0D%0A', '/')).toBe('/');
		expect(safeRedirectPath('/app?x=%0a', '/')).toBe('/');
		expect(safeRedirectPath('/app#%0d', '/')).toBe('/');
	});

	it('decodes only once, leaving double-encoded sequences literal', () => {
		// %25%30%64 decodes once to the literal text "%0d", not a CR; the value
		// is a same-origin path and is preserved verbatim (the consumer never
		// decodes a second time).
		expect(safeRedirectPath('/x%25%30%64', '/')).toBe('/x%25%30%64');
	});

	it('rejects scheme-relative targets that resolve cross-origin', () => {
		// A leading scheme with no authority slashes slips a naive `//` check yet
		// navigates to http://evil.com/ from an https origin.
		expect(safeRedirectPath('http:evil.com', '/')).toBe('/');
		expect(safeRedirectPath('http:/evil.com', '/')).toBe('/');
		expect(safeRedirectPath('http:\\evil.com', '/')).toBe('/');
	});

	it('rejects an absolute URL whose host matches the sentinel origin', () => {
		expect(safeRedirectPath('http://redirect.invalid/x', '/')).toBe('/');
	});

	it('rejects embedded credentials in the authority', () => {
		expect(safeRedirectPath('//user:pass@redirect.invalid/x', '/')).toBe('/');
	});

	it('canonicalizes the accepted path so check and use agree', () => {
		expect(safeRedirectPath('/a/../b', '/')).toBe('/b');
		expect(safeRedirectPath('/café?q=hello world#x y', '/')).toBe(
			'/caf%C3%A9?q=hello%20world#x%20y'
		);
	});

	it('rejects a javascript: URI', () => {
		expect(safeRedirectPath('javascript:alert(1)', '/')).toBe('/');
	});

	it('rejects an empty string', () => {
		expect(safeRedirectPath('', '/')).toBe('/');
	});

	it('returns / as the fallback when passed as the fallback argument', () => {
		expect(safeRedirectPath('//evil.com', '/')).toBe('/');
	});

	it('returns a custom fallback when the path is invalid', () => {
		expect(safeRedirectPath('http://evil.com', '/home')).toBe('/home');
	});
});

describe('oauthErrorCallbackURL', () => {
	it('returns the bare page path when there is nothing to carry', () => {
		expect(oauthErrorCallbackURL('/signin', '')).toBe('/signin');
	});

	it('carries a valid destination through the failed attempt', () => {
		expect(oauthErrorCallbackURL('/signin', '/app/settings')).toBe(
			'/signin?redirectTo=%2Fapp%2Fsettings'
		);
	});

	it('keeps the localized page path', () => {
		expect(oauthErrorCallbackURL('/de/signup', '/de/app')).toBe(
			'/de/signup?redirectTo=%2Fde%2Fapp'
		);
	});

	// The value comes from the current URL, so an attacker controls it. Better
	// Auth appends `&error=` and redirects the browser to whatever this returns.
	it.each(['//evil.com', 'http://evil.com', '/\\evil.com'])(
		'drops the destination rather than emit an open redirect (%s)',
		(hostile) => {
			expect(oauthErrorCallbackURL('/signin', hostile)).toBe('/signin');
		}
	);
});

describe('splitDestinationError', () => {
	it('lifts a verification failure out of the destination', () => {
		expect(splitDestinationError('/de/app/settings?error=TOKEN_EXPIRED')).toEqual({
			destination: '/de/app/settings',
			errorCode: 'TOKEN_EXPIRED'
		});
	});

	it('keeps the rest of the destination intact', () => {
		expect(splitDestinationError('/app?tab=billing&error=INVALID_TOKEN#plans')).toEqual({
			destination: '/app?tab=billing#plans',
			errorCode: 'INVALID_TOKEN'
		});
	});

	it('leaves a destination without a failure alone', () => {
		expect(splitDestinationError('/de/app/settings')).toEqual({
			destination: '/de/app/settings',
			errorCode: null
		});
	});

	it('does not mistake a parameter that merely ends in error for the code', () => {
		expect(splitDestinationError('/app?last_error=none')).toEqual({
			destination: '/app?last_error=none',
			errorCode: null
		});
	});

	it("leaves the application's own error parameter alone", () => {
		// Consuming this would report a checkout failure as an auth failure and
		// drop the state the caller asked to arrive with.
		expect(splitDestinationError('/app?error=checkout_failed&tab=billing')).toEqual({
			destination: '/app?error=checkout_failed&tab=billing',
			errorCode: null
		});
	});

	it("finds the appended code behind the caller's own error parameter", () => {
		// Better Auth appends its code to whatever the callback URL already was,
		// so a destination carrying an `error` of its own pushes the one that
		// matters into second place. Reading only the first value reports nothing
		// and leaves the code to ride into the next verification link.
		expect(splitDestinationError('/app?error=checkout_failed&error=TOKEN_EXPIRED')).toEqual({
			destination: '/app?error=checkout_failed',
			errorCode: 'TOKEN_EXPIRED'
		});
	});

	it('takes every copy of the appended code with it', () => {
		// A repeat of the same code is not a caller's parameter that happens to
		// collide: leaving one behind puts it into `redirectTo`, and the next
		// link built from that destination reports the previous attempt's failure
		// even after it succeeds.
		expect(splitDestinationError('/app?error=INVALID_TOKEN&error=INVALID_TOKEN')).toEqual({
			destination: '/app',
			errorCode: 'INVALID_TOKEN'
		});
	});

	it('leaves an error that belongs to the destination alone', () => {
		expect(splitDestinationError('/app?error=checkout_failed&error=checkout_failed')).toEqual({
			destination: '/app?error=checkout_failed&error=checkout_failed',
			errorCode: null
		});
	});

	it('normalizes what it returns, and the whitelist still gates it', () => {
		// URL parsing accepts far more than the redirect whitelist does, so the
		// destination coming out of here is not trusted on its way out either.
		// Every caller re-validates it, and this is the pair that shows why.
		expect(splitDestinationError('%?error=TOKEN_EXPIRED')).toEqual({
			destination: '/%',
			errorCode: 'TOKEN_EXPIRED'
		});
		expect(safeRedirectPath('/%', '/app')).toBe('/app');
	});
});

describe('safeAuthDestination', () => {
	it('keeps a localized page destination whole', () => {
		expect(safeAuthDestination('/en/app/settings?tab=billing', '/en/app')).toBe(
			'/en/app/settings?tab=billing'
		);
		expect(safeAuthDestination('/de', '/de/app')).toBe('/de');
		expect(safeAuthDestination('/fr?checkout=pro', '/fr/app')).toBe('/fr?checkout=pro');
	});

	/**
	 * The reason this exists. Both of these are same-origin and both pass the
	 * Better Auth callback grammar, so `safeRedirectPath` alone hands them to
	 * the recovery verification link. Cloudflare serves a root asset before this
	 * application's Worker is reached, so appending `?error=TOKEN_EXPIRED` to one
	 * produces the file and no message at all.
	 */
	it('refuses a destination that is not a page', () => {
		expect(safeAuthDestination('/favicon.ico', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('/robots.txt', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('/sitemap.xml', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('/_app/immutable/chunk.js', '/en/app')).toBe('/en/app');
	});

	/**
	 * A prefixless path is not a loss: handleLanguage redirects one to its
	 * localized form before any auth rule reads it, so the fallback lands the
	 * visitor where the prefixless value would have taken them anyway.
	 */
	/**
	 * Two letters is not a locale. `/zz/app` would pass a shape check, and
	 * handleLanguage then localizes it into `/en/zz/app`, which is a 404 rather
	 * than the page anyone meant.
	 */
	it('refuses a prefix that is not a language this app serves', () => {
		expect(safeAuthDestination('/zz/app', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('/EN/app', '/en/app')).toBe('/en/app');
		for (const lang of ['en', 'de', 'es', 'fr']) {
			expect(safeAuthDestination(`/${lang}/app/settings`, '/en/app')).toBe(`/${lang}/app/settings`);
		}
	});

	it('refuses a path without the language prefix', () => {
		expect(safeAuthDestination('/app', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('/pricing', '/en/app')).toBe('/en/app');
	});

	it('still rejects everything safeRedirectPath rejects', () => {
		expect(safeAuthDestination('//evil.example/en/app', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('https://evil.example/en/app', '/en/app')).toBe('/en/app');
		expect(safeAuthDestination('', '/en/app')).toBe('/en/app');
	});
});

describe('authPageURL', () => {
	/** Das Ziel, wie die Seite am anderen Ende es zurückliest. */
	function carried(url: string): string | null {
		return new URL(url, 'https://redirect.invalid').searchParams.get('redirectTo');
	}

	it('hands a whole destination on to the next auth page', () => {
		const url = authPageURL('/de/forgot-password', '/de/app/settings?tab=profile#section');

		expect(url).toBe(
			'/de/forgot-password?redirectTo=%2Fde%2Fapp%2Fsettings%3Ftab%3Dprofile%23section'
		);
		expect(carried(url)).toBe('/de/app/settings?tab=profile#section');
	});

	/**
	 * Der Grund für das Wrapping: die Callback-Regel erlaubt kein `#`, ein Ziel mit
	 * Fragment fällt also ganz weg. Im Query ist es `%23` und kommt durch.
	 */
	it('keeps a fragment the callback grammar would have cost', () => {
		expect(callbackURLFor('/de/app/settings#section', '/de/app')).toBe('/de/app');

		const url = authPageURL('/de/signin', '/de/app/settings#section');
		expect(callbackURLFor(url, '/de/app')).toBe(url);
		expect(carried(url)).toBe('/de/app/settings#section');
	});

	it.each(['en', 'de', 'es', 'fr'])('carries a %s destination', (lang) => {
		const destination = `/${lang}/app/settings?tab=profile#section`;
		const url = authPageURL(`/${lang}/forgot-password`, destination);

		expect(url.startsWith(`/${lang}/forgot-password?redirectTo=`)).toBe(true);
		expect(carried(url)).toBe(destination);
	});

	/**
	 * Die sechs Zeichen, die `encodeURIComponent` roh lässt. Ungeschützt antwortet
	 * Better Auth mit `403 INVALID_CALLBACK_URL` und reißt die Anfrage mit.
	 */
	it.each([
		['!', '%21'],
		["'", '%27'],
		['(', '%28'],
		[')', '%29'],
		['*', '%2A'],
		['~', '%7E']
	])('escapes %s, which the callback grammar refuses', (character, escaped) => {
		const destination = `/de/app/a${character}b`;
		const url = authPageURL('/de/signin', destination);

		expect(url).toBe(`/de/signin?redirectTo=%2Fde%2Fapp%2Fa${escaped}b`);
		expect(url).not.toContain(character);
		expect(callbackURLFor(url, '/de/app')).toBe(url);
		expect(carried(url)).toBe(destination);
	});

	/**
	 * Jede Seite der Kette baut den Link für die nächste aus dem gelesenen Wert.
	 * Doppelt kodiert käme das Ziel als eigene Escape-Sequenz an.
	 */
	it('does not add a layer per page in the chain', () => {
		const destination = '/de/app/settings?tab=profile#section';

		const forgot = authPageURL('/de/forgot-password', destination);
		const reset = authPageURL('/de/reset-password', carried(forgot)!);
		const signin = authPageURL('/de/signin', carried(reset)!);

		expect(carried(signin)).toBe(destination);
		expect(signin).toBe(authPageURL('/de/signin', destination));
	});

	it('gives the bare page when there is nothing to carry', () => {
		expect(authPageURL('/de/forgot-password', '')).toBe('/de/forgot-password');
	});

	// Dieselbe Whitelist wie eine echte Navigation: der Wert landet in einem Link
	// und im Callback, auf den Better Auth weiterleitet.
	it.each([
		'//evil.com',
		'/\\evil.com',
		'http://evil.com',
		'http:evil.com',
		'javascript:alert(1)',
		'/%2f%2fevil.com',
		'//user:pass@redirect.invalid/x',
		'/de/%zz',
		'/de/app%0d%0aLocation:%20https://evil.test',
		'/de/app\nLocation: https://evil.test',
		'/app',
		'/pricing',
		'/favicon.ico',
		'/zz/app'
	])('drops %s rather than carry it', (hostile) => {
		expect(authPageURL('/de/signin', hostile)).toBe('/de/signin');
	});
});
