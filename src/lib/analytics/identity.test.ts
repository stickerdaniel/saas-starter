import { describe, expect, it } from 'vitest';
import { classifySession, planIdentity, type SessionSnapshot } from './identity';

const user = (id: string, impersonatedBy: string | null = null): SessionSnapshot['data'] => ({
	user: { id },
	session: { impersonatedBy }
});

describe('classifySession', () => {
	it('keeps analytics closed while the session is uncertain', () => {
		expect(classifySession({ data: null, isPending: true, error: null })).toEqual({
			kind: 'pending'
		});
		expect(
			classifySession({ data: user('u1'), isPending: false, isRefetching: true, error: null })
		).toEqual({ kind: 'pending' });
		// A failed refetch keeps the previous data; it is not a fresh answer.
		expect(classifySession({ data: user('u1'), isPending: false, error: { status: 500 } })).toEqual(
			{
				kind: 'pending'
			}
		);
	});

	it('treats a 401 as a confirmed signed-out visitor', () => {
		expect(classifySession({ data: null, isPending: false, error: { status: 401 } })).toEqual({
			kind: 'anonymous'
		});
	});

	it('distinguishes users from impersonation', () => {
		expect(classifySession({ data: user('u1'), isPending: false, error: null })).toEqual({
			kind: 'user',
			userId: 'u1'
		});
		expect(classifySession({ data: user('u1', 'admin'), isPending: false, error: null })).toEqual({
			kind: 'impersonating'
		});
		expect(classifySession({ data: null, isPending: false, error: null })).toEqual({
			kind: 'anonymous'
		});
	});
});

describe('planIdentity', () => {
	const anonymousSdk = { identified: false, distinctId: 'anon' };

	it('does nothing for an anonymous visitor who stays anonymous', () => {
		expect(planIdentity({ kind: 'anonymous' }, anonymousSdk)).toEqual({
			ready: true,
			resetFirst: false,
			identify: undefined
		});
	});

	it('merges the anonymous visitor into the user who signs in', () => {
		expect(planIdentity({ kind: 'user', userId: 'u1' }, anonymousSdk)).toEqual({
			ready: true,
			resetFirst: false,
			identify: 'u1'
		});
	});

	it('resets before identifying a different user', () => {
		expect(
			planIdentity({ kind: 'user', userId: 'u2' }, { identified: true, distinctId: 'u1' })
		).toEqual({ ready: true, resetFirst: true, identify: 'u2' });
		expect(
			planIdentity({ kind: 'user', userId: 'u1' }, { identified: true, distinctId: 'u1' })
		).toEqual({ ready: true, resetFirst: false, identify: undefined });
	});

	it('resets on sign-out', () => {
		expect(planIdentity({ kind: 'anonymous' }, { identified: true, distinctId: 'u1' })).toEqual({
			ready: true,
			resetFirst: true,
			identify: undefined
		});
	});

	it('stays closed while pending or impersonating', () => {
		expect(planIdentity({ kind: 'pending' }, anonymousSdk)).toEqual({ ready: false });
		expect(planIdentity({ kind: 'impersonating' }, anonymousSdk)).toEqual({ ready: false });
	});
});
