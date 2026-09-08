import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from '../../_generated/server';
import { ensurePreviewAdmin } from '../../previewDev';
import { syncAdminPreferences } from './helpers';
import { getNotificationTargetEmails } from '../support/notifications';
import { getRecipientsForNotificationType, type NotificationType } from './queries';

type Preference = {
	_id: string;
	_creationTime: number;
	email: string;
	userId?: string;
	isAdminUser: boolean;
	notifyNewSupportTickets: boolean;
	notifyUserReplies: boolean;
	notifyNewSignups: boolean;
	createdAt: number;
	updatedAt: number;
};

type ConvexHandler<TArgs, TResult> = {
	_handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const ensurePreviewAdminHandler = (
	ensurePreviewAdmin as unknown as ConvexHandler<
		Record<string, never>,
		{
			created: boolean;
			updatedRole: boolean;
			updatedVerification: boolean;
			skipped: boolean;
		}
	>
)._handler;

const getRecipientsHandler = (
	getRecipientsForNotificationType as unknown as ConvexHandler<{ type: NotificationType }, string[]>
)._handler;

const getSupportRecipientsHandler = (
	getNotificationTargetEmails as unknown as ConvexHandler<
		{
			assignedTo?: string;
			notificationType: 'newTickets' | 'userReplies';
		},
		string[]
	>
)._handler;

function makePreference(
	email: string,
	userId: string,
	overrides: Partial<Preference> = {}
): Preference {
	return {
		_id: `preference_${userId}`,
		_creationTime: 1,
		email,
		userId,
		isAdminUser: true,
		notifyNewSupportTickets: true,
		notifyUserReplies: true,
		notifyNewSignups: true,
		createdAt: 1,
		updatedAt: 1,
		...overrides
	};
}

function createPreferenceStore(initial: Preference[] = []) {
	const rows = initial.map((row) => ({ ...row }));
	let nextId = rows.length + 1;

	const db = {
		query: (table: string) => {
			expect(table).toBe('adminNotificationPreferences');
			return {
				collect: async () => [...rows],
				withIndex: (
					_index: string,
					configure: (query: { eq: (field: string, value: unknown) => unknown }) => unknown
				) => {
					const filters: Record<string, unknown> = {};
					const query = {
						eq: (field: string, value: unknown) => {
							filters[field] = value;
							return query;
						}
					};
					configure(query);
					return {
						first: async () =>
							rows.find((row) =>
								Object.entries(filters).every(
									([field, value]) => row[field as keyof Preference] === value
								)
							) ?? null
					};
				}
			};
		},
		insert: async (table: string, value: Omit<Preference, '_id' | '_creationTime'>) => {
			expect(table).toBe('adminNotificationPreferences');
			const id = `preference_${nextId++}`;
			rows.push({ _id: id, _creationTime: Date.now(), ...value });
			return id;
		},
		patch: async (id: string, value: Partial<Preference>) => {
			const row = rows.find((candidate) => candidate._id === id);
			if (!row) throw new Error(`Unknown preference: ${id}`);
			Object.assign(row, value);
		}
	};

	return { db, rows };
}

function expectEmailToggles(preference: Preference, enabled: boolean) {
	expect(preference).toMatchObject({
		notifyNewSupportTickets: enabled,
		notifyUserReplies: enabled,
		notifyNewSignups: enabled
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('preview admin notification preferences', () => {
	it('creates a normalized preview admin preference with email disabled', async () => {
		const { db, rows } = createPreferenceStore();

		await syncAdminPreferences(dbContext(db), {
			userId: 'preview-user',
			email: '  ADMIN@PREVIEW.DEV '
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			email: 'admin@preview.dev',
			userId: 'preview-user',
			isAdminUser: true
		});
		expectEmailToggles(rows[0], false);
	});

	it('reattaches a stale preview preference during idempotent ensure runs', async () => {
		const { db, rows } = createPreferenceStore([
			makePreference('admin@preview.dev', 'stale-preview-user')
		]);
		const user = {
			_id: 'current-preview-user',
			email: 'admin@preview.dev',
			role: 'admin',
			emailVerified: true
		};
		const ctx = {
			db,
			runQuery: vi.fn(async () => user),
			runMutation: vi.fn()
		};
		vi.stubEnv('PREVIEW_ADMIN_PASSWORD', 'preview-password');
		vi.stubEnv('LOCAL_CONVEX_DEV', 'false');

		const first = await ensurePreviewAdminHandler(ctx, {});
		const second = await ensurePreviewAdminHandler(ctx, {});

		expect(first).toEqual({
			created: false,
			updatedRole: false,
			updatedVerification: false,
			skipped: true
		});
		expect(second).toEqual(first);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			email: 'admin@preview.dev',
			userId: 'current-preview-user',
			isAdminUser: true
		});
		expectEmailToggles(rows[0], false);
		expect(ctx.runMutation).not.toHaveBeenCalled();
	});

	it('keeps a real email collision attached to its existing user', async () => {
		const existing = makePreference('owner@example.com', 'existing-owner');
		const { db, rows } = createPreferenceStore([existing]);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		await syncAdminPreferences(dbContext(db), {
			userId: 'different-owner',
			email: ' OWNER@EXAMPLE.COM '
		});

		expect(rows).toEqual([existing]);
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining('email=owner@example.com already belongs to userId=existing-owner')
		);
	});

	it('excludes the preview admin from every recipient type despite stored toggles', async () => {
		const { db } = createPreferenceStore([
			makePreference('  ADMIN@PREVIEW.DEV ', 'preview-user'),
			makePreference('owner@example.com', 'owner-user')
		]);

		for (const type of ['newTickets', 'userReplies', 'newSignups'] as const) {
			await expect(getRecipientsHandler({ db }, { type })).resolves.toEqual(['owner@example.com']);
		}
	});

	it('excludes a normalized preview address from both support notification types', async () => {
		const { db } = createPreferenceStore([
			makePreference('  ADMIN@PREVIEW.DEV ', 'preview-user'),
			makePreference('owner@example.com', 'owner-user')
		]);

		for (const notificationType of ['newTickets', 'userReplies'] as const) {
			await expect(getSupportRecipientsHandler({ db }, { notificationType })).resolves.toEqual([
				'owner@example.com'
			]);
		}
	});

	it('falls back to a real admin when a support ticket is assigned to the preview admin', async () => {
		const { db } = createPreferenceStore([
			makePreference('admin@preview.dev', 'preview-user'),
			makePreference('owner@example.com', 'owner-user')
		]);

		for (const notificationType of ['newTickets', 'userReplies'] as const) {
			await expect(
				getSupportRecipientsHandler({ db }, { assignedTo: 'preview-user', notificationType })
			).resolves.toEqual(['owner@example.com']);
		}
	});

	it('keeps real admin defaults enabled and eligible for every recipient type', async () => {
		const { db, rows } = createPreferenceStore();

		await syncAdminPreferences(dbContext(db), {
			userId: 'owner-user',
			email: ' Owner@Example.com '
		});

		expect(rows[0]).toMatchObject({
			email: 'owner@example.com',
			isAdminUser: true
		});
		expectEmailToggles(rows[0], true);
		for (const type of ['newTickets', 'userReplies', 'newSignups'] as const) {
			await expect(getRecipientsHandler({ db }, { type })).resolves.toEqual(['owner@example.com']);
		}
	});
});

function dbContext(db: ReturnType<typeof createPreferenceStore>['db']): MutationCtx {
	return { db } as unknown as MutationCtx;
}
