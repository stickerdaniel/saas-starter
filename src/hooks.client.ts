import { dev } from '$app/environment';
import { getPosthog } from '$lib/analytics/posthog';
import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, status }) => {
	// Don't report 404s
	if (status === 404) return;

	if (dev) {
		console.error('Client error:', error);
	}

	getPosthog()?.captureException(error);
};
