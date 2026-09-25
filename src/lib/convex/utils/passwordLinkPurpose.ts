/**
 * Which of the two password mails a reset link came from.
 *
 * Better Auth sends the same reset link whether or not the account has a
 * password, and `resetPassword` creates the credential account when it is
 * missing. The mail picks its wording from that state; this carries the same
 * verdict to the page the link opens, as a parameter on the callback that
 * Better Auth forwards together with the token.
 *
 * Wording only. Anyone can edit the URL, so the parameter must never decide
 * anything the token or the server decides.
 */
export type PasswordLinkPurpose = 'reset' | 'set';

export const PASSWORD_LINK_PURPOSE_PARAM = 'purpose';

/** Read the purpose from the page URL. Anything but `set` keeps the reset wording. */
export function passwordLinkPurpose(params: URLSearchParams): PasswordLinkPurpose {
	return params.get(PASSWORD_LINK_PURPOSE_PARAM) === 'set' ? 'set' : 'reset';
}

/**
 * Mark a Better Auth reset link as a set-password link.
 *
 * The link is `<baseURL>/reset-password/<token>?callbackURL=<page>`, and Better
 * Auth redirects to `<page>` with the token added, so the marker goes onto
 * `callbackURL` rather than onto the link itself. The callback is edited as text
 * instead of being re-serialized, because Better Auth validates a relative
 * callback against a strict pattern that the existing encoding already passes,
 * and parsing would also turn a relative callback into an absolute one.
 *
 * The marker replaces any purpose already on the callback, since the page reads
 * the first one, and goes before a fragment, where a trusted absolute callback
 * may keep one.
 *
 * A link without a callback is returned unchanged: Better Auth answers it with
 * its own error page, which no wording here reaches.
 */
export function withPasswordLinkPurpose(resetUrl: string, purpose: PasswordLinkPurpose): string {
	if (purpose === 'reset') return resetUrl;

	let url: URL;
	try {
		url = new URL(resetUrl);
	} catch {
		return resetUrl;
	}

	const callback = url.searchParams.get('callbackURL');
	if (!callback) return resetUrl;

	const hashAt = callback.indexOf('#');
	const beforeHash = hashAt === -1 ? callback : callback.slice(0, hashAt);
	const fragment = hashAt === -1 ? '' : callback.slice(hashAt);
	const queryAt = beforeHash.indexOf('?');
	const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
	const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

	// Each pair is decoded on its own, so a key spelled with escapes still counts
	// while the kept pairs stay exactly as they were written.
	const pairs = query
		.split('&')
		.filter((pair) => pair !== '' && !new URLSearchParams(pair).has(PASSWORD_LINK_PURPOSE_PARAM));
	pairs.push(`${PASSWORD_LINK_PURPOSE_PARAM}=set`);

	url.searchParams.set('callbackURL', `${path}?${pairs.join('&')}${fragment}`);
	return url.href;
}
