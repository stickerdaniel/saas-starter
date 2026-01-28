// src/routes/+layout.ts
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data }) => {
	// Pass through server data (authState, autumnState)
	// PostHog initialization moved to +layout.svelte for deferred loading
	return data;
};
