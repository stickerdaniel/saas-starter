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

/**
 * Generate a random delay between 16-19 minutes for founder welcome emails.
 * Randomized to feel organic rather than automated.
 */
export function getFounderWelcomeDelay(): number {
	const MIN_DELAY = 16 * 60 * 1000; // 16 minutes
	const MAX_DELAY = 19 * 60 * 1000; // 19 minutes
	return MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY));
}

/** Default content for founder welcome email */
export const FOUNDER_WELCOME_DEFAULTS = {
	subject: 'A quick hello',
	body: `Hey {{userFirstName}},

I'm {{founderName}}, {{founderTitle}}. I wanted to say thanks for giving us a try.

I know there are a lot of tools out there, so the fact that you chose to spend time with ours means a lot. If anything feels confusing or missing, I genuinely want to know. This is the kind of feedback that shapes what we build next.

Reply anytime. I read every response.

{{founderName}}
{{founderTitle}}`
} as const;
