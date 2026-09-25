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
 * `callbackURL` rather than onto the link itself. It is appended as text instead
 * of re-serializing the callback, because Better Auth validates a relative
 * callback against a strict pattern and the existing encoding already passes it.
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

	const separator = callback.includes('?') ? '&' : '?';
	url.searchParams.set('callbackURL', `${callback}${separator}${PASSWORD_LINK_PURPOSE_PARAM}=set`);
	return url.href;
}
