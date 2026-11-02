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

/**
 * Default content for the founder feedback email. It goes only to signups who have
 * never paid, 48 hours after signup or verification, as a reply to their welcome
 * when there is one and standalone otherwise.
 */
export const FOUNDER_FEEDBACK_DEFAULTS = {
	subject: 'A quick question',
	body: `Hey {{userFirstName}},

Did you get stuck somewhere, or was it just not the right time?

If we can't do what you need yet, tell me what you had in mind. I read every reply.

{{founderName}}`
} as const;

/**
 * Default content for the founder cancellation email, sent standalone about an hour
 * after a customer schedules a cancellation, while their plan is still active.
 */
export const FOUNDER_CANCELLATION_DEFAULTS = {
	subject: 'Sorry to see you go',
	body: `Hi {{userFirstName}},

I saw you cancelled your subscription. Thanks for giving us a go.

What was missing? Just reply, this comes straight to me.

Thanks,
{{founderName}}`
} as const;

/**
 * Delay before the founder feedback email: 48 hours after signup (OAuth) or
 * verification (email/password), plus up to 20 minutes of jitter so a batch of
 * signups does not land in one burst. The send-time billing check skips everyone
 * who paid in the meantime.
 */
export function getFounderFeedbackDelay(): number {
	const BASE_DELAY = 48 * 60 * 60 * 1000;
	const MAX_JITTER = 20 * 60 * 1000;
	return BASE_DELAY + Math.floor(Math.random() * MAX_JITTER);
}

/** The `founderEmailSends` dedupe key of the feedback email: one per account. */
export const FOUNDER_FEEDBACK_DEDUPE_KEY = 'signup';

/**
 * How long after a scheduled cancellation the founder cancellation email waits, so
 * a customer who cancels by mistake and resumes right away is not asked.
 */
export const FOUNDER_CANCELLATION_DELAY_MS = 60 * 60 * 1000;

/**
 * How long after a scheduled cancellation an observation may still open the
 * cancellation email. Every later billing webhook observes the same cancellation
 * again, so without this bound switching the email on would ask customers who
 * cancelled weeks ago.
 */
export const FOUNDER_CANCELLATION_MAX_OBSERVATION_AGE_MS = 3 * 60 * 60 * 1000;

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
