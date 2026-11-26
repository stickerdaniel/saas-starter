import { createAuthClient } from 'better-auth/svelte';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { authBaseURL } from './auth-client';

export const oauthAuthClient = createAuthClient({
	baseURL: authBaseURL,
	plugins: [oauthProviderClient(), passkeyClient()]
});
