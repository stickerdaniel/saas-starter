import { dev, browser } from '$app/environment';
import { PUBLIC_SENTRY_DSN } from '$env/static/public';
import { getPosthog } from '$lib/analytics/posthog';
import * as Sentry from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';

if (browser && PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: PUBLIC_SENTRY_DSN,
		tracesSampleRate: 0.1
	});
}

const customHandleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;

	if (dev) {
		console.error('Client error:', error);
	}

	getPosthog()?.captureException(error);
};

export const handleError = PUBLIC_SENTRY_DSN
	? Sentry.handleErrorWithSentry(customHandleError)
	: customHandleError;
