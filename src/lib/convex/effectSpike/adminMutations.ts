/** T0 spike: `admin/mutations.setUserRole` on the Effect adapter. */
import * as Clock from 'effect/Clock';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { v, type Value } from 'convex/values';
import { components } from '../_generated/api';
import { ADMIN_ERROR_CODES, type AdminErrorCode } from '../admin/errors';
import { incrementCounter } from '../admin/counters';
import {
	deactivateAdminPreferencesHelper,
	syncAdminPreferences
} from '../admin/notificationPreferences/helpers';
import { roleValidator, type BetterAuthUser } from '../admin/types';
import { call, DatabaseWriter, MutationRunner, QueryRunner } from '../effect';
import { CurrentUser, effectAdminMutation } from '../effectAuth';

/** The admin refusals, declared: the client reads `data.code` as before. */
export class AdminRefusal extends Data.TaggedError('AdminRefusal')<{
	readonly code: AdminErrorCode;
	readonly data?: Readonly<Record<string, Value>>;
}> {}

const findUserById = (userId: string) =>
	call(
		QueryRunner,
		(runQuery) =>
			runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', operator: 'eq', value: userId }]
			}) as Promise<BetterAuthUser | null>
	);

/** Port of `admin/mutations.setUserRole`, with its refusals declared. */
export const setUserRole = effectAdminMutation({
	args: { userId: v.string(), role: roleValidator },
	returns: v.object({ success: v.boolean() }),
	errors: [AdminRefusal],
	handler: (args) =>
		Effect.gen(function* () {
			const actor = yield* CurrentUser;
			if (actor._id === args.userId) {
				return yield* new AdminRefusal({ code: ADMIN_ERROR_CODES.cannotChangeOwnRole });
			}
			const user = yield* findUserById(args.userId);
			if (!user) return yield* new AdminRefusal({ code: ADMIN_ERROR_CODES.userNotFound });

			const wasAdmin = user.role === 'admin';
			const isAdmin = args.role === 'admin';
			if (wasAdmin && !isAdmin) {
				const admins = yield* call(QueryRunner, (runQuery) =>
					runQuery(components.betterAuth.adapter.findMany, {
						model: 'user',
						where: [{ field: 'role', operator: 'eq', value: 'admin' }],
						paginationOpts: { cursor: null, numItems: 2 }
					})
				);
				if (admins.page.length < 2) {
					return yield* new AdminRefusal({ code: ADMIN_ERROR_CODES.lastAdmin });
				}
			}

			yield* call(MutationRunner, (runMutation) =>
				runMutation(components.betterAuth.adapter.updateOne, {
					input: {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: args.userId }],
						update: { role: args.role }
					}
				})
			);
			const db = yield* DatabaseWriter;
			if (wasAdmin !== isAdmin) {
				yield* Effect.promise(() => incrementCounter({ db }, 'adminCount', isAdmin ? 1 : -1));
			}
			if (!wasAdmin && isAdmin) {
				yield* Effect.promise(() =>
					syncAdminPreferences({ db }, { userId: args.userId, email: user.email })
				);
			} else if (wasAdmin && !isAdmin) {
				yield* Effect.promise(() => deactivateAdminPreferencesHelper({ db }, args.userId));
			}
			const timestamp = yield* Clock.currentTimeMillis;
			yield* Effect.promise(() =>
				db.insert('adminAuditLogs', {
					adminUserId: actor._id,
					action: 'set_role',
					targetUserId: args.userId,
					metadata: { newRole: args.role, previousRole: user.role ?? 'user' },
					timestamp
				})
			);
			return { success: true };
		})
});
