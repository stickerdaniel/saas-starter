import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { adminClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { browser } from '$app/environment';

export const authClient = createAuthClient({
	baseURL: browser ? window.location.origin : undefined,
	plugins: [convexClient(), passkeyClient(), adminClient()]
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
	// Cast to bypass TypeScript since additionalFields are defined on the server
	// but not automatically inferred by the client
	await authClient.updateUser(data as Parameters<typeof authClient.updateUser>[0]);
}
