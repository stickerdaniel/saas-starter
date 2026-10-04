import { authClient } from '$lib/auth-client';
import { api } from '$lib/convex/_generated/api';
import type { ConvexClient } from 'convex/browser';
import { PASSKEY_NUDGE_DELAY, isFreshPasskeySession } from './passkey-nudge-policy';

export type PasskeyNudgeUser = {
	userId: string;
	sessionId: string;
	name: string;
	email: string;
};

export async function withNudgeDeadline<T>(work: Promise<T>, milliseconds = 6000): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Passkey nudge timed out')), milliseconds);
			})
		]);
	} finally {
		clearTimeout(timer!);
	}
}

/** Optional onboarding fails open; an outage must never hold up a successful login. */
export async function claimPasskeyNudge(
	client: ConvexClient,
	expectedSessionId?: string
): Promise<PasskeyNudgeUser | null> {
	if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return null;
	try {
		const { data, error } = await authClient.getSession({
			fetchOptions: { signal: AbortSignal.timeout(5000) }
		});
		if (error || !data || !data.user.emailVerified || !isFreshPasskeySession(data.session))
			return null;
		if (expectedSessionId && data.session.id !== expectedSessionId) return null;
		const seenKey = `auth:passkey-nudge:session:${data.session.id}`;
		const deferredKey = `auth:passkey-nudge:deferred:${data.user.id}`;
		if (sessionStorage.getItem(seenKey) || Number(localStorage.getItem(deferredKey)) > Date.now())
			return null;
		const [passkeys, deferredUntil] = await withNudgeDeadline(
			Promise.all([
				authClient.passkey.listUserPasskeys({
					fetchOptions: { signal: AbortSignal.timeout(5000) }
				}),
				client.query(api.users.getPasskeyNudgeDismissal, {})
			])
		);
		if (passkeys.error || !passkeys.data || passkeys.data.length || deferredUntil > Date.now())
			return null;
		sessionStorage.setItem(seenKey, '1');
		return {
			userId: data.user.id,
			sessionId: data.session.id,
			name: data.user.name,
			email: data.user.email
		};
	} catch {
		return null;
	}
}

export async function deferPasskeyNudge(client: ConvexClient, userId: string): Promise<void> {
	try {
		localStorage.setItem(
			`auth:passkey-nudge:deferred:${userId}`,
			String(Date.now() + PASSKEY_NUDGE_DELAY)
		);
	} catch {
		// The server still remembers the choice when browser storage is unavailable.
	}
	try {
		await withNudgeDeadline(client.mutation(api.users.dismissPasskeyNudge, {}), 2500);
	} catch {
		// Keep the local deferral and let the user continue if the connection drops.
	}
}
