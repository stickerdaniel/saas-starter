import { PersistedState } from 'runed';

export type LastAuthMethod = 'google' | 'github' | 'passkey';
export type PendingOAuthProvider = 'google' | 'github';

const LAST_AUTH_METHOD_STORAGE_KEY = 'auth:last-auth-method';
const PENDING_OAUTH_PROVIDER_STORAGE_KEY = 'auth:pending-oauth-provider';

export const lastSuccessfulAuthMethod = new PersistedState<LastAuthMethod | null>(
	LAST_AUTH_METHOD_STORAGE_KEY,
	null
);

export const pendingOAuthProvider = new PersistedState<PendingOAuthProvider | null>(
	PENDING_OAUTH_PROVIDER_STORAGE_KEY,
	null,
	{
		storage: 'session'
	}
);

export function beginOAuth(provider: PendingOAuthProvider) {
	pendingOAuthProvider.current = provider;
}

export function commitOAuthSuccessIfPending() {
	const provider = pendingOAuthProvider.current;
	if (!provider) return;
	if (provider === 'google' || provider === 'github') {
		lastSuccessfulAuthMethod.current = provider;
	}
	pendingOAuthProvider.current = null;
}

export function setLastSuccessfulAuthMethod(method: LastAuthMethod) {
	lastSuccessfulAuthMethod.current = method;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(LAST_AUTH_METHOD_STORAGE_KEY, JSON.stringify(method));
	}
}

export function clearLastSuccessfulAuthMethod() {
	lastSuccessfulAuthMethod.current = null;
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(LAST_AUTH_METHOD_STORAGE_KEY);
	}
}

export function clearPendingOAuthProvider() {
	if (pendingOAuthProvider.current !== null) {
		pendingOAuthProvider.current = null;
	}
}
