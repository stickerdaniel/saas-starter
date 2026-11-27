import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import type { FunctionArgs } from 'convex/server';
import { components } from '../../convex/_generated/api';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, Scheduler } from '../_generated/services';
import cleanup from './cleanup.spec';
import { deleteEpoch } from './grants';

const STALE_CLIENT_AGE = Duration.hours(24);

const PAGE = { numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };

const CLIENT_PAGE = { ...PAGE, numItems: 50 };

const ClientRow = Schema.Struct({ _id: Schema.String, clientId: Schema.String });

const decodeClient = Schema.decodeUnknownOption(ClientRow);

type DeleteManyInput = FunctionArgs<typeof components.betterAuth.adapter.deleteMany>['input'];

const deletePage = (input: DeleteManyInput) =>
	Effect.gen(function* () {
		const ctx = yield* MutationCtx;
		return yield* Effect.promise(() =>
			ctx.runMutation(components.betterAuth.adapter.deleteMany, {
				input,
				paginationOpts: { cursor: null, ...PAGE }
			})
		);
	});

const hasConsent = (clientId: string) =>
	Effect.gen(function* () {
		const ctx = yield* MutationCtx;
		const consent = yield* Effect.promise(() =>
			ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'oauthConsent',
				where: [{ field: 'clientId', operator: 'eq', value: clientId }],
				select: ['_id']
			})
		);
		return consent !== null;
	});

const deleteClient = (client: typeof ClientRow.Type) =>
	Effect.gen(function* () {
		const ctx = yield* MutationCtx;
		for (;;) {
			const links = yield* deletePage({
				model: 'oauthClientResource',
				where: [{ field: 'clientId', operator: 'eq', value: client.clientId }]
			});
			if (links.isDone) break;
		}
		yield* Effect.promise(() =>
			ctx.runMutation(components.betterAuth.adapter.deleteOne, {
				input: {
					model: 'oauthClient',
					where: [{ field: '_id', operator: 'eq', value: client._id }]
				}
			})
		);
	});

export default GroupImpl.make(databaseSchema, cleanup).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, cleanup, 'deleteStaleClients', ({ cursor }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const createdBefore = Date.now() - Duration.toMillis(STALE_CLIENT_AGE);
				const page = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findMany, {
						model: 'oauthClient',
						where: [{ field: 'createdAt', operator: 'lt', value: createdBefore }],
						paginationOpts: { cursor: cursor ?? null, ...CLIENT_PAGE }
					})
				);
				for (const client of page.page.flatMap((row: unknown) =>
					Option.toArray(decodeClient(row))
				)) {
					if (!(yield* hasConsent(client.clientId))) yield* deleteClient(client);
				}
				if (!page.isDone) {
					yield* (yield* Scheduler).runAfter(
						Duration.zero,
						refs.internal.oauth.cleanup.deleteStaleClients,
						{ cursor: page.continueCursor }
					);
				}
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, cleanup, 'deleteExpiredTokens', () =>
			Effect.gen(function* () {
				const now = Date.now();
				const accessTokens = yield* deletePage({
					model: 'oauthAccessToken',
					where: [{ field: 'expiresAt', operator: 'lt', value: now }]
				});
				const refreshTokens = yield* deletePage({
					model: 'oauthRefreshToken',
					where: [{ field: 'expiresAt', operator: 'lt', value: now }]
				});
				if (!accessTokens.isDone || !refreshTokens.isDone) {
					yield* (yield* Scheduler).runAfter(
						Duration.zero,
						refs.internal.oauth.cleanup.deleteExpiredTokens,
						{}
					);
				}
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, cleanup, 'eraseUserGrants', ({ userId }) =>
			Effect.gen(function* () {
				const consents = yield* deletePage({
					model: 'oauthConsent',
					where: [{ field: 'userId', operator: 'eq', value: userId }]
				});
				if (!consents.isDone) {
					yield* (yield* Scheduler).runAfter(
						Duration.zero,
						refs.internal.oauth.cleanup.eraseUserGrants,
						{ userId }
					);
					return null;
				}
				const ctx = yield* MutationCtx;
				const uses = yield* Effect.promise(() =>
					ctx.db
						.query('oauthConnectionUses')
						.withIndex('by_userId_and_clientId', (q) => q.eq('userId', userId))
						.paginate({ cursor: null, ...PAGE })
				);
				for (const use of uses.page) {
					yield* Effect.promise(() => ctx.db.delete('oauthConnectionUses', use._id));
				}
				if (!uses.isDone) {
					yield* (yield* Scheduler).runAfter(
						Duration.zero,
						refs.internal.oauth.cleanup.eraseUserGrants,
						{ userId }
					);
					return null;
				}
				yield* Effect.promise(() => deleteEpoch(ctx.db, userId));
				return null;
			})
		)
	]),
	GroupImpl.finalize
);
