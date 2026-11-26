import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Duration from 'effect/Duration';
import * as Schema from 'effect/Schema';
import type { GenericDatabaseReader } from 'convex/server';
import { components } from '../../convex/_generated/api';
import type { DataModel } from '../../convex/_generated/dataModel';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import RequireUserImpl from '../middleware/RequireUser.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import connections from './connections.spec';
import { currentEpoch, raiseEpoch } from './grants';
import { USE_RECORD_INTERVAL } from './resource';

const ConsentRow = Schema.Struct({
	_id: Schema.String,
	clientId: Schema.String,
	referenceId: Schema.optional(Schema.NullOr(Schema.String)),
	scopes: Schema.Array(Schema.String),
	createdAt: Schema.optional(Schema.NullOr(Schema.Number))
});

const ClientRow = Schema.Struct({
	clientId: Schema.String,
	name: Schema.optional(Schema.NullOr(Schema.String))
});

const decodeConsent = Schema.decodeUnknownOption(ConsentRow);
const decodeClient = Schema.decodeUnknownOption(ClientRow);

const useRow = (db: GenericDatabaseReader<DataModel>, userId: string, clientId: string) =>
	db
		.query('oauthConnectionUses')
		.withIndex('by_userId_and_clientId', (q) => q.eq('userId', userId).eq('clientId', clientId))
		.unique();

const clientNames = (clientIds: readonly string[]) =>
	Effect.gen(function* () {
		if (clientIds.length === 0) return new Map<string, string | null>();
		const ctx = yield* QueryCtx;
		const result = yield* Effect.promise(() =>
			ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'oauthClient',
				where: [{ field: 'clientId', operator: 'in', value: [...clientIds] }],
				select: ['clientId', 'name'],
				paginationOpts: { cursor: null, numItems: clientIds.length }
			})
		);
		const clients: ReadonlyArray<typeof ClientRow.Type> = result.page.flatMap((row: unknown) =>
			Option.toArray(decodeClient(row))
		);
		return new Map(clients.map((client) => [client.clientId, client.name ?? null] as const));
	});

export default GroupImpl.make(databaseSchema, connections).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, connections, 'epoch', ({ userId }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => currentEpoch(ctx.db, userId));
			})
		),
		FunctionImpl.make(databaseSchema, connections, 'list', ({ paginationOpts }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const { _id: userId } = yield* CurrentUser;
				const result = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findMany, {
						model: 'oauthConsent',
						where: [{ field: 'userId', operator: 'eq', value: userId }],
						paginationOpts
					})
				);
				const consents: ReadonlyArray<typeof ConsentRow.Type> = result.page.flatMap(
					(row: unknown) => Option.toArray(decodeConsent(row))
				);
				const names = yield* clientNames([...new Set(consents.map(({ clientId }) => clientId))]);
				const uses = yield* Effect.promise(() =>
					Promise.all(consents.map(({ clientId }) => useRow(ctx.db, userId, clientId)))
				);
				return {
					page: consents.map((consent, index) => {
						const use = uses[index];
						return {
							consentId: consent._id,
							clientId: consent.clientId,
							clientName: names.get(consent.clientId) ?? null,
							scopes: consent.scopes,
							connectedAt: consent.createdAt ?? null,
							lastUsedAt: use && use.grant === consent.referenceId ? use.lastUsedAt : null
						};
					}),
					isDone: result.isDone,
					continueCursor: result.continueCursor
				};
			})
		),
		FunctionImpl.make(databaseSchema, connections, 'revoke', ({ consentId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const { _id: userId } = yield* CurrentUser;
				const consent = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'oauthConsent',
						where: [{ field: '_id', operator: 'eq', value: consentId }],
						select: ['userId', 'clientId']
					})
				);
				if (consent?.userId !== userId) return { revoked: false };
				yield* Effect.promise(() =>
					ctx.runMutation(components.betterAuth.adapter.deleteOne, {
						input: {
							model: 'oauthConsent',
							where: [{ field: '_id', operator: 'eq', value: consentId }]
						}
					})
				);
				yield* Effect.promise(() => raiseEpoch(ctx.db, userId));
				const use = yield* Effect.promise(() => useRow(ctx.db, userId, consent.clientId));
				if (use) yield* Effect.promise(() => ctx.db.delete('oauthConnectionUses', use._id));
				return { revoked: true };
			})
		),
		FunctionImpl.make(databaseSchema, connections, 'recordUse', ({ userId, clientId, grant, at }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const consent = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'oauthConsent',
						where: [
							{ field: 'clientId', operator: 'eq', value: clientId },
							{ field: 'referenceId', operator: 'eq', value: grant },
							{ field: 'userId', operator: 'eq', value: userId }
						],
						select: ['_id']
					})
				);
				if (consent === null) return null;
				const use = yield* Effect.promise(() => useRow(ctx.db, userId, clientId));
				if (use === null) {
					yield* Effect.promise(() =>
						ctx.db.insert('oauthConnectionUses', { userId, clientId, grant, lastUsedAt: at })
					);
				} else if (use.grant !== grant) {
					yield* Effect.promise(() =>
						ctx.db.patch('oauthConnectionUses', use._id, { grant, lastUsedAt: at })
					);
				} else if (at - use.lastUsedAt >= Duration.toMillis(USE_RECORD_INTERVAL)) {
					yield* Effect.promise(() =>
						ctx.db.patch('oauthConnectionUses', use._id, { lastUsedAt: at })
					);
				}
				return null;
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
