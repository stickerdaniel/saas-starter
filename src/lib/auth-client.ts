import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { adminClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { browser } from '$app/environment';

export const authClient = createAuthClient({
	baseURL: browser ? window.location.origin : undefined,
	plugins: [convexClient(), passkeyClient(), adminClient()]
});
