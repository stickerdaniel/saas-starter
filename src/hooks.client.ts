import { dev, browser } from '$app/env';
import { loadSentry } from '#lib/monitoring/sentry.js';
import type { HandleClientError } from '@sveltejs/kit/hooks';

// SvelteKit 3 also passes expected `error(...)` results (kind 'app') here. Like before,
// only unexpected errors and framework errors other than a 404 are logged.
const customHandleError: HandleClientError = ({ kind, error }) => {
	if (kind === 'app' || (kind === 'framework' && error.status === 404)) return;

	if (dev) {
		console.error('Client error:', error);
	}
};

// Sentry loads lazily (see #lib/monitoring/sentry) so the SDK stays out of
// the first-paint bundle and is dropped entirely when PUBLIC_SENTRY_DSN is
// unset. Errors thrown before the SDK resolves are only logged in dev.
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
