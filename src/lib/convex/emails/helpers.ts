/**
 * Shared helpers for email sending logic.
 *
 * Extracted from send.ts so they can be imported by both
 * production code and unit tests without pulling in Convex runtime deps.
 */

/**
 * Check if an email address belongs to an E2E test user.
 * Test emails are skipped to prevent sending real emails during automated testing.
 */
export function isTestEmail(email: string): boolean {
	return email.endsWith('@e2e.example.com');
}

/**
 * Check if email should be skipped for E2E test users and log if so.
 * Returns true if email was skipped, false if it should be sent.
 */
export function shouldSkipTestEmail(action: string, email: string): boolean {
	if (isTestEmail(email)) {
		console.log(`[${action}] Skipping test email: ${email}`);
		return true;
	}
	return false;
}

/** Default content for founder welcome email */
export const FOUNDER_WELCOME_DEFAULTS = {
	subject: 'A quick hello',
	body: `Hey {{userFirstName}},

I'm {{founderName}}, {{founderTitle}}. Thanks for signing up.

Try the [AI chat](https://saas.daniel.sticker.name/app/ai-chat) in the demo. The admin features, these emails included, show up when you [run it locally](https://github.com/stickerdaniel/saas-starter#quick-start).

**P.S. What brought you here?**

Hit reply and tell me. I read and answer every email myself.

Cheers,
{{founderName}}`
} as const;

/** Build a support link on the configured site while retaining the source page state. */
export function buildSupportDeepLink(
	pageUrl: string | undefined,
	siteUrl: string,
	threadId: string
): string {
	const target = new URL(siteUrl);
	try {
		// Stored support routes are pathnames, which resolve against the site.
		const isRootRelativePath =
			pageUrl?.startsWith('/') && !pageUrl.startsWith('//') && !pageUrl.includes('\\');
		const source =
			pageUrl && isRootRelativePath ? new URL(pageUrl, siteUrl) : new URL(pageUrl || siteUrl);
		target.pathname = source.pathname;
		target.search = source.search;
		target.hash = source.hash;
	} catch {
		// The configured site root is the safe fallback for malformed stored URLs.
	}

	target.searchParams.set('support', 'open');
	target.searchParams.set('thread', threadId);
	return target.toString();
}
