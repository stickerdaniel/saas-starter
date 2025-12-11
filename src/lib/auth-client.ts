import { createAuthClient } from 'better-auth/svelte';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { passkeyClient, adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [convexClient(), passkeyClient(), adminClient()]
});
