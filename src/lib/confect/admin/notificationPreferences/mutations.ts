import * as Effect from 'effect/Effect';
import { components } from '../../../convex/_generated/api';
import type { MutationCtx as ConvexMutationCtx } from '../../../convex/_generated/server';
import { isEmailAddress } from '../../../effect/schema';
import { MutationCtx } from '../../_generated/services';
import { NotificationPreferenceRefusal } from '../../errorCodecs';
import {
	NOTIFICATION_EMAIL_ALREADY_EXISTS,
	NOTIFICATION_PREFERENCE_ERROR_CODES,
	type NotificationPreferenceErrorCode
} from './errors';
import { syncAdminPreferences } from './helpers';
import type { PreferenceBatchArgsSchema, PreferenceToggleArgsSchema } from './schemas';

const MAX_PREFERENCE_BATCH_SIZE = 50;

const withCtx = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const refuse = (code: NotificationPreferenceErrorCode) =>
	Effect.fail(new NotificationPreferenceRefusal({ code }));

const findByEmail = (email: string) =>
	withCtx((ctx) =>
		ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first()
	);

const togglablePreference = (email: string) =>
	Effect.gen(function* () {
		const pref = yield* withCtx((ctx) =>
			ctx.db
				.query('adminNotificationPreferences')
				.withIndex('by_email', (q) => q.eq('email', email))
				.unique()
		);
		if (!pref) return yield* refuse(NOTIFICATION_PREFERENCE_ERROR_CODES.notFound);
		if (!pref.isAdminUser && pref.userId !== undefined) {
			return yield* refuse(NOTIFICATION_PREFERENCE_ERROR_CODES.dormant);
		}
		return pref;
	});

export const updateOnePreference = ({
	email,
	field,
	value
}: typeof PreferenceToggleArgsSchema.Type) =>
	Effect.gen(function* () {
		const pref = yield* togglablePreference(email);
		yield* withCtx((ctx) =>
			ctx.db.patch('adminNotificationPreferences', pref._id, {
				[field]: value,
				updatedAt: Date.now()
			})
		);
		return null;
	});

export const updateManyPreferences = ({
	emails,
	field,
	value
}: typeof PreferenceBatchArgsSchema.Type) =>
	Effect.gen(function* () {
		if (
			emails.length === 0 ||
			emails.length > MAX_PREFERENCE_BATCH_SIZE ||
			new Set(emails).size !== emails.length
		) {
			return yield* refuse(NOTIFICATION_PREFERENCE_ERROR_CODES.invalidBatch);
		}
		const prefs = yield* Effect.forEach(emails, togglablePreference, { concurrency: 'unbounded' });
		const updatedAt = Date.now();
		yield* withCtx(async (ctx) => {
			for (const pref of prefs) {
				await ctx.db.patch('adminNotificationPreferences', pref._id, {
					[field]: value,
					updatedAt
				});
			}
		});
		return null;
	});

export const addCustomRecipient = (rawEmail: string) =>
	Effect.gen(function* () {
		const email = rawEmail.toLowerCase().trim();
		if (!isEmailAddress(email)) {
			return yield* refuse(NOTIFICATION_PREFERENCE_ERROR_CODES.invalidEmail);
		}
		if (yield* findByEmail(email)) return yield* refuse(NOTIFICATION_EMAIL_ALREADY_EXISTS);
		const now = Date.now();
		yield* withCtx((ctx) =>
			ctx.db.insert('adminNotificationPreferences', {
				email,
				userId: undefined,
				isAdminUser: false,
				notifyNewSupportTickets: true,
				notifyUserReplies: true,
				notifyNewSignups: true,
				notifyNewCustomers: true,
				notifyCancellations: true,
				createdAt: now,
				updatedAt: now
			})
		);
		return null;
	});

export const removeCustomRecipient = (rawEmail: string) =>
	Effect.gen(function* () {
		const pref = yield* findByEmail(rawEmail.toLowerCase().trim());
		if (!pref) return yield* refuse(NOTIFICATION_PREFERENCE_ERROR_CODES.emailNotFound);
		if (pref.userId !== undefined) {
			return yield* refuse(NOTIFICATION_PREFERENCE_ERROR_CODES.adminRecipientRequired);
		}
		yield* withCtx((ctx) => ctx.db.delete('adminNotificationPreferences', pref._id));
		return null;
	});

export const syncAllAdmins = withCtx(async (ctx) => {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		paginationOpts: { cursor: null, numItems: 1000 }
	});

	const users = result.page as Array<{ _id: string; email: string; role?: string | null }>;
	const admins = users.filter((u) => u.role === 'admin');

	let synced = 0;
	let skipped = 0;

	for (const admin of admins) {
		const existing = await ctx.db
			.query('adminNotificationPreferences')
			.withIndex('by_user', (q) => q.eq('userId', admin._id))
			.first();

		if (existing) {
			skipped++;
			continue;
		}

		await syncAdminPreferences(ctx, { userId: admin._id, email: admin.email });
		synced++;
	}

	console.log(`Synced ${synced} admins, skipped ${skipped} (already existed)`);
	return { synced, skipped };
});
