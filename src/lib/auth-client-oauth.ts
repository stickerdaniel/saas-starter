import { createAuthClient } from 'better-auth/svelte';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { authBaseURL } from './auth-client';

export const oauthAuthClient = createAuthClient({
	baseURL: authBaseURL,
	plugins: [oauthProviderClient()]
});
