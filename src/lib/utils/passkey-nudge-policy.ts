import { safeAuthDestination } from './url';

export const PASSKEY_NUDGE_DELAY = 30 * 24 * 60 * 60 * 1000;
const FRESH_SIGN_IN_WINDOW = 5 * 60 * 1000;

export function passkeyDestination(destination: string, fallback: string): string {
	const safe = safeAuthDestination(destination, fallback);
	// An enrollment page cannot be its own continuation, including nested links.
	return /^\/[a-z]{2}\/(passkey-setup|signin|signup|email-verified|reset-password)(?:[?#]|$)/.test(
		safe
	)
		? fallback
		: safe;
}

export function isFreshPasskeySession(
	session: { createdAt: Date | string; impersonatedBy?: string | null },
	now = Date.now()
): boolean {
	const age = now - new Date(session.createdAt).getTime();
	return !session.impersonatedBy && age >= 0 && age < FRESH_SIGN_IN_WINDOW;
}
