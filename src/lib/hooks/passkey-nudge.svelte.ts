import { PersistedState } from 'runed';
import { useConvexClient } from 'convex-svelte';
import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
import { authClient } from '$lib/auth-client';
import { isFreshPasskeySession } from '$lib/utils/passkey-nudge-policy';
import { claimPasskeyNudge, type PasskeyNudgeUser } from '$lib/utils/passkey-nudge';
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

/**
 * Holds a claimed OAuth passkey offer for the app shell. The offer lives here rather than in
 * the sidebar, which remounts its content when it switches between the desktop rail and the
 * mobile sheet; a claimed offer is marked as seen, so losing it would hide it for the session.
 * Create it during component initialisation: it reads context and owns an effect.
 */
export class PasskeyNudgeClaim {
	#auth = useAuth();
	#offer = $state<{ user: PasskeyNudgeUser; provider: PendingOAuthProvider } | null>(null);

	constructor(enabled: () => boolean) {
		const client = useConvexClient();
		$effect(() => {
			const pending = pendingPasskeyNudge.current;
			if (!enabled() || this.#auth.isLoading || !this.#auth.isAuthenticated || !pending) return;
			let cancelled = false;
			void claimPasskeyNudge(client, pending.sessionId).then((user) => {
				if (cancelled) return;
				pendingPasskeyNudge.current = null;
				if (user && this.#auth.isAuthenticated) this.#offer = { user, provider: pending.provider };
			});
			return () => {
				cancelled = true;
			};
		});
	}

	get offer() {
		return this.#auth.isAuthenticated ? this.#offer : null;
	}

	dismiss() {
		this.#offer = null;
	}
}
