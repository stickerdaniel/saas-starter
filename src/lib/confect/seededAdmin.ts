import * as Effect from 'effect/Effect';
import { components } from '../convex/_generated/api';
import type { MutationCtx } from '../convex/_generated/server';
import { readSeedUser } from '../convex-components/betterAuth/seedUser';
import { syncAdminPreferences } from './admin/notificationPreferences/helpers';
import { createAuth } from './authServer';

type SeededAdmin = {
	readonly email: string;
	readonly password: string;
	readonly name: string;
	readonly label: string;
};

const findUserByEmail = (ctx: MutationCtx, email: string) =>
	Effect.promise(() =>
		ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', operator: 'eq', value: email }]
		})
	).pipe(Effect.map(readSeedUser));

export const ensureSeededAdmin = (
	ctx: MutationCtx,
	{ email, password, name, label }: SeededAdmin
) =>
	Effect.gen(function* () {
		const existing = yield* findUserByEmail(ctx, email);
		const created = existing === null;
		if (created) {
			yield* Effect.promise(() =>
				createAuth(ctx).api.createUser({ body: { email, password, name, role: 'admin' } })
			);
		}
		const user = existing ?? (yield* findUserByEmail(ctx, email));
		if (!user) {
			return yield* Effect.die(new Error(`Failed to create or find ${label}: ${email}`));
		}

		const updatedRole = user.role !== 'admin';
		const updatedVerification = user.emailVerified !== true;
		if (updatedRole || updatedVerification) {
			yield* Effect.promise(() =>
				ctx.runMutation(components.betterAuth.adapter.updateOne, {
					input: {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: user._id }],
						update: {
							...(updatedRole ? { role: 'admin' } : {}),
							...(updatedVerification ? { emailVerified: true } : {})
						}
					}
				})
			);
		}

		yield* Effect.promise(() => syncAdminPreferences(ctx, { userId: user._id, email }));

		return {
			created,
			updatedRole,
			updatedVerification,
			skipped: !created && !updatedRole && !updatedVerification
		};
	});
