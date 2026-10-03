import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), listUserPasskeys: vi.fn() }));
vi.mock('$lib/auth-client', () => ({
	authClient: { getSession: auth.getSession, passkey: { listUserPasskeys: auth.listUserPasskeys } }
}));

import { claimPasskeyNudge, deferPasskeyNudge } from './passkey-nudge';
import {
	isFreshPasskeySession,
	passkeyDestination,
	PASSKEY_NUDGE_DELAY
} from './passkey-nudge-policy';

const query = vi.fn();
const mutation = vi.fn();
const client = { query, mutation } as unknown as ConvexClient;

// The fields consumed from Better Auth's get-session response. createdAt is
// decoded to a Date by its client; raw JSON carries the equivalent ISO string.
function session(userId = 'user-a', sessionId = 'session-a') {
	return {
		data: {
			user: { id: userId, name: 'Ada Example', email: 'ada@example.com', emailVerified: true },
			session: { id: sessionId, createdAt: new Date(), impersonatedBy: null }
		},
		error: null
	};
}

beforeEach(() => {
	vi.stubGlobal('isSecureContext', true);
	vi.stubGlobal('PublicKeyCredential', class {});
	vi.stubGlobal('navigator', { credentials: {} });
	localStorage.clear();
	sessionStorage.clear();
	auth.getSession.mockResolvedValue(session());
	auth.listUserPasskeys.mockResolvedValue({ data: [], error: null });
	query.mockResolvedValue(0);
	mutation.mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.resetAllMocks();
	vi.useRealTimers();
});

describe('optional passkey enrollment', () => {
	it('offers once per session and keeps another account eligible', async () => {
		expect(await claimPasskeyNudge(client)).toMatchObject({ userId: 'user-a' });
		expect(await claimPasskeyNudge(client)).toBeNull();
		auth.getSession.mockResolvedValue(session('user-b', 'session-b'));
		expect(await claimPasskeyNudge(client)).toMatchObject({ userId: 'user-b' });
	});

	it.each([
		{ data: [{ id: 'already-registered' }], error: null },
		{ data: null, error: { status: 503 } },
		{ data: null, error: null }
	])('skips an existing or indeterminate passkey list', async (response) => {
		auth.listUserPasskeys.mockResolvedValue(response);
		expect(await claimPasskeyNudge(client)).toBeNull();
	});

	it('skips unsupported browsers without querying the account', async () => {
		vi.stubGlobal('PublicKeyCredential', undefined);
		expect(await claimPasskeyNudge(client)).toBeNull();
		expect(auth.getSession).not.toHaveBeenCalled();
	});

	it('skips a failed lookup and a slow backend without marking the session seen', async () => {
		query.mockRejectedValueOnce(new Error('offline'));
		expect(await claimPasskeyNudge(client)).toBeNull();
		vi.useFakeTimers();
		query.mockReturnValueOnce(new Promise(() => {}));
		const slow = claimPasskeyNudge(client);
		await vi.advanceTimersByTimeAsync(6000);
		expect(await slow).toBeNull();
		query.mockResolvedValueOnce(0);
		expect(await claimPasskeyNudge(client)).not.toBeNull();
	});

	it('honors the account dismissal across sessions and its 30-day expiry', async () => {
		vi.useFakeTimers();
		await deferPasskeyNudge(client, 'user-a');
		expect(mutation).toHaveBeenCalledWith(expect.anything(), {});
		auth.getSession.mockResolvedValue(session('user-a', 'another-session'));
		expect(await claimPasskeyNudge(client)).toBeNull();
		vi.setSystemTime(Date.now() + PASSKEY_NUDGE_DELAY);
		auth.getSession.mockResolvedValue(session('user-a', 'later-session'));
		expect(await claimPasskeyNudge(client)).not.toBeNull();
	});

	it('honors a server dismissal on a different browser', async () => {
		query.mockResolvedValue(Date.now() + PASSKEY_NUDGE_DELAY);
		expect(await claimPasskeyNudge(client)).toBeNull();
	});

	it('retains a local dismissal when the server cannot save it', async () => {
		mutation.mockRejectedValueOnce(new Error('offline'));
		await deferPasskeyNudge(client, 'user-a');
		expect(await claimPasskeyNudge(client)).toBeNull();
	});

	it('rejects a pending OAuth offer for another session', async () => {
		expect(await claimPasskeyNudge(client, 'old-session')).toBeNull();
		expect(query).not.toHaveBeenCalled();
	});

	it('does not offer for impersonation, unverified email, or a restored session', async () => {
		const current = session();
		current.data.user.emailVerified = false;
		auth.getSession.mockResolvedValue(current);
		expect(await claimPasskeyNudge(client)).toBeNull();
		expect(isFreshPasskeySession({ createdAt: new Date(), impersonatedBy: 'admin' })).toBe(false);
		expect(isFreshPasskeySession({ createdAt: new Date(Date.now() - 300_000) })).toBe(false);
		expect(isFreshPasskeySession({ createdAt: 'invalid' })).toBe(false);
	});

	it('preserves safe deep links and refuses external redirects and auth loops', () => {
		const destination = '/de/app/settings?tab=billing#invoices';
		expect(passkeyDestination(destination, '/de/app')).toBe(destination);
		for (const unsafe of [
			'//evil.test',
			'/en/passkey-setup?redirectTo=/de/passkey-setup',
			'/de/signin'
		]) {
			expect(passkeyDestination(unsafe, '/de/app')).toBe('/de/app');
		}
	});
});
