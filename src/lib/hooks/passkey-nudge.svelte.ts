import { persisted } from '#lib/storage/persisted.svelte.ts';
import { authClient } from '#lib/auth-client.js';
import { isFreshPasskeySession } from '#lib/utils/passkey-nudge-policy.js';
import type { PendingOAuthProvider } from './last-auth-method.svelte.ts';

export const pendingPasskeyNudge = persisted<{
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
