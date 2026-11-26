import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { components } from '../../convex/_generated/api';
import databaseSchema from '../_generated/schema';
import { QueryCtx } from '../_generated/services';
import { createAuth } from '../authServer';
import access from './access.spec';

const TokenPayload = Schema.Struct({
	active: Schema.Literal(true),
	client_id: Schema.String,
	sub: Schema.String,
	exp: Schema.Number,
	scope: Schema.optional(Schema.String),
	aud: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
	grant: Schema.optional(Schema.String),
	cnf: Schema.optional(Schema.Unknown)
});

const decodePayload = Schema.decodeUnknownOption(TokenPayload);

export default GroupImpl.make(databaseSchema, access).pipe(
	Layer.provide(
		FunctionImpl.make(databaseSchema, access, 'verify', ({ token, audiences }) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const decoded = decodePayload(
					yield* Effect.promise(() => createAuth(ctx).api.mcpAccessVerify({ body: { token } }))
				);
				if (Option.isNone(decoded)) return null;
				const payload = decoded.value;
				if (payload.cnf !== undefined || payload.grant === undefined) return null;
				const named = new Set(payload.aud === undefined ? [] : [payload.aud].flat());
				const audience = audiences.find((candidate) => named.has(candidate));
				if (audience === undefined) return null;
				const grant = payload.grant;
				const consent = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'oauthConsent',
						where: [
							{ field: 'clientId', operator: 'eq', value: payload.client_id },
							{ field: 'referenceId', operator: 'eq', value: grant },
							{ field: 'userId', operator: 'eq', value: payload.sub }
						],
						select: ['scopes']
					})
				);
				if (consent === null) return null;
				const user = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: payload.sub }],
						select: ['_id', 'banned']
					})
				);
				if (user === null || user.banned === true) return null;
				const use = yield* Effect.promise(() =>
					ctx.db
						.query('oauthConnectionUses')
						.withIndex('by_userId_and_clientId', (q) =>
							q.eq('userId', payload.sub).eq('clientId', payload.client_id)
						)
						.unique()
				);
				const ceiling = new Set<string>(consent.scopes);
				return {
					userId: payload.sub,
					clientId: payload.client_id,
					scopes: (payload.scope ?? '').split(' ').filter((scope) => ceiling.has(scope)),
					expiresAt: payload.exp * 1000,
					grant,
					audience,
					useRecordedAt: use?.grant === grant ? use.lastUsedAt : null
				};
			})
		)
	),
	GroupImpl.finalize
);
