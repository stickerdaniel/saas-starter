import { dev, browser } from '$app/environment';
import { getPosthog } from '$lib/analytics/posthog';
import { loadSentry } from '$lib/monitoring/sentry';
import type { HandleClientError } from '@sveltejs/kit';

const customHandleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;

	if (dev) {
		console.error('Client error:', error);
	}

	getPosthog()?.captureException(error);
};

// Sentry loads lazily (see $lib/monitoring/sentry) so the SDK stays out of
// the first-paint bundle and is dropped entirely when PUBLIC_SENTRY_DSN is
// unset. Errors thrown before the SDK resolves fall back to the PostHog
// path below, the same race tolerance getPosthog() already has.
let sentryHandleError: HandleClientError | null = null;

if (browser) {
	void loadSentry().then((sentry) => {
		if (sentry) {
			sentryHandleError = sentry.handleErrorWithSentry(customHandleError);
		}
	});
}

export const handleError: HandleClientError = (input) =>
	(sentryHandleError ?? customHandleError)(input);
