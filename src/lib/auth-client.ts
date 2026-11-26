import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import type { createAuth } from './confect/authServer';
import { passkeyClient } from '@better-auth/passkey/client';
import { browser } from '$app/env';

export const authBaseURL = browser ? window.location.origin : undefined;

export const authClient = createAuthClient({
	baseURL: authBaseURL,
	plugins: [
		convexClient(),
		passkeyClient(),
		adminClient(),
		inferAdditionalFields<ReturnType<typeof createAuth>>()
	]
});

/**
 * Update user with additional fields like locale.
 * This is a typed wrapper around authClient.updateUser that includes
 * additional fields defined in the server's user.additionalFields config.
 */
export async function updateUserWithLocale(data: {
	name?: string;
	image?: string | null;
	locale?: string;
}): Promise<void> {
	await authClient.updateUser(data);
}
