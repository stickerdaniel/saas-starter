import { PersistedState } from 'runed';
import { authClient } from '#lib/auth-client.js';
import { isFreshPasskeySession } from '#lib/utils/passkey-nudge-policy.js';
import type { PendingOAuthProvider } from './last-auth-method.svelte.ts';

// eslint-disable-next-line local/no-module-state-singleton -- Browser-only sessionStorage state, never written during SSR
export const pendingPasskeyNudge = new PersistedState<{
	sessionId: string;
	provider: PendingOAuthProvider;
} | null>('auth:pending-passkey-nudge', null, { storage: 'session' });

export async function offerPasskeyAfterOAuth(provider: PendingOAuthProvider): Promise<void> {
	try {
		const { data } = await authClient.getSession({
			fetchOptions: { signal: AbortSignal.timeout(5000) }
		});
		if (data && isFreshPasskeySession(data.session)) {
			pendingPasskeyNudge.current = { sessionId: data.session.id, provider };
		}
	} catch {
		// A failed optional offer does not affect the completed OAuth sign-in.
	}
}
