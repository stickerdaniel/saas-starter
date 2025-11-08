// src/routes/+layout.ts
import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { PUBLIC_POSTHOG_API_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data }) => {
	if (browser && PUBLIC_POSTHOG_API_KEY) {
		posthog.init(PUBLIC_POSTHOG_API_KEY, {
			api_host: PUBLIC_POSTHOG_HOST,
			person_profiles: 'identified_only' // or 'always' to create profiles for anonymous users as well
		});
	}

	// Pass through server data (authState, autumnState)
	return data;
};
