import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ERROR_CODES } from '../errors';
import { NOTIFICATION_PREFERENCE_ERROR_CODES } from './errors';

const authUser = vi.hoisted(() => ({ current: { _id: 'admin_1', role: 'admin' } }));
vi.mock('../../auth', () => ({
	authComponent: { getAuthUser: vi.fn(async () => authUser.current) }
}));

import { updatePreferences } from './mutations';

type Args = { emails: string[]; field: 'notifyNewSignups'; value: boolean };
const handler = (
	updatePreferences as unknown as { _handler: (ctx: unknown, args: Args) => Promise<null> }
)._handler;

type Preference = {
	_id: string;
	email: string;
	userId?: string;
	isAdminUser: boolean;
	notifyNewSignups: boolean;
	updatedAt: number;
};

/** One preference row per email, with signups off; `dormant` emails belong to demoted admins. */
function preferencesCtx(emails: string[], dormant: string[] = []) {
	const rows: Preference[] = emails.map((email, index) => ({
		_id: `preference_${index}`,
		email,
		userId: dormant.includes(email) ? `user_${index}` : undefined,
		isAdminUser: false,
		notifyNewSignups: false,
		updatedAt: 0
	}));
	const patch = vi.fn(async (_table: string, id: string, value: Partial<Preference>) => {
		Object.assign(
			rows.find((row) => row._id === id)!,
			value
		);
	});
	const db = {
		query: () => ({
			withIndex: (
				_index: string,
				configure: (q: { eq: (field: string, value: string) => unknown }) => unknown
			) => {
				let email = '';
				configure({ eq: (_field, value) => (email = value) });
				return { first: async () => rows.find((row) => row.email === email) ?? null };
			}
		}),
		patch
	};
	const signups = () => Object.fromEntries(rows.map((row) => [row.email, row.notifyNewSignups]));
	return { ctx: { db }, patch, signups };
}

const emails = ['a@x.test', 'b@x.test', 'c@x.test'];
const toggleOn = (list: string[]): Args => ({
	emails: list,
	field: 'notifyNewSignups',
	value: true
});
const codeOf = (code: string) => expect.objectContaining({ data: { code } });

beforeEach(() => {
	authUser.current = { _id: 'admin_1', role: 'admin' };
});

describe('updatePreferences', () => {
	it('sets the toggle on every listed recipient', async () => {
		const { ctx, signups } = preferencesCtx(emails);

		await handler(ctx, toggleOn(emails));

		expect(signups()).toEqual({ 'a@x.test': true, 'b@x.test': true, 'c@x.test': true });
	});

	it('changes no recipient when one of them is dormant', async () => {
		const { ctx, patch, signups } = preferencesCtx(emails, ['c@x.test']);

		await expect(handler(ctx, toggleOn(emails))).rejects.toEqual(
			codeOf(NOTIFICATION_PREFERENCE_ERROR_CODES.dormant)
		);

		expect(patch).not.toHaveBeenCalled();
		expect(signups()).toEqual({ 'a@x.test': false, 'b@x.test': false, 'c@x.test': false });
	});

	it('changes no recipient when one email is unknown', async () => {
		const { ctx, patch } = preferencesCtx(emails);

		await expect(handler(ctx, toggleOn([...emails, 'missing@x.test']))).rejects.toEqual(
			codeOf(NOTIFICATION_PREFERENCE_ERROR_CODES.notFound)
		);

		expect(patch).not.toHaveBeenCalled();
	});

	it.each([
		['an empty list', []],
		['more than 50 emails', Array.from({ length: 51 }, (_, index) => `r${index}@x.test`)],
		['a duplicate email', ['a@x.test', 'b@x.test', 'a@x.test']]
	])('rejects %s before writing', async (_label, list) => {
		const { ctx, patch } = preferencesCtx([...new Set(list)]);

		await expect(handler(ctx, toggleOn(list))).rejects.toEqual(
			codeOf(NOTIFICATION_PREFERENCE_ERROR_CODES.invalidBatch)
		);

		expect(patch).not.toHaveBeenCalled();
	});

	it('accepts a full page of 50 emails', async () => {
		const page = Array.from({ length: 50 }, (_, index) => `r${index}@x.test`);
		const { ctx, patch } = preferencesCtx(page);

		await handler(ctx, toggleOn(page));

		expect(patch).toHaveBeenCalledTimes(50);
	});

	it('rejects a caller without the admin role', async () => {
		authUser.current = { _id: 'user_1', role: 'user' };
		const { ctx, patch } = preferencesCtx(emails);

		await expect(handler(ctx, toggleOn(emails))).rejects.toEqual(
			codeOf(ADMIN_ERROR_CODES.accessRequired)
		);

		expect(patch).not.toHaveBeenCalled();
	});
});
