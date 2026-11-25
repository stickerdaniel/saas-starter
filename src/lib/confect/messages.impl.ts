import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { components } from '../convex/_generated/api';
import refs from './_generated/refs';
import databaseSchema from './_generated/schema';
import { MutationCtx, MutationRunner, QueryCtx, Scheduler } from './_generated/services';
import { ensureCaptureStart } from './admin/journey/capture';
import { checkAndCountUsage } from './autumn';
import { MAX_MESSAGE_LENGTH } from './constants';
import { requireBillingConfiguration } from './env';
import { CommunityRefusal } from './errorCodecs';
import RequireUserImpl from './middleware/RequireUser.impl';
import { CurrentUser } from './middleware/RequireUser.spec';
import messages from './messages.spec';
import { appRateLimiter } from './rateLimit';
import { RateLimited } from '../effect/errors';

const MessageAuthor = Schema.Struct({
	_id: Schema.String,
	name: Schema.optional(Schema.String),
	email: Schema.optional(Schema.String),
	image: Schema.optional(Schema.NullOr(Schema.String))
});

const authorOf = Schema.decodeUnknownOption(MessageAuthor);

export default GroupImpl.make(databaseSchema, messages).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			messages,
			'enforceAndTrackMessageUsage',
			({ userId, messageId }) =>
				Effect.gen(function* () {
					const outcome = yield* Effect.promise(() =>
						checkAndCountUsage({ customerId: userId, featureId: 'messages' })
					);
					const mutations = yield* MutationRunner;
					yield* mutations
						.runMutation(
							outcome === 'denied'
								? refs.internal.messages.removeMessage
								: refs.internal.messages.markMessageSettled,
							{ messageId }
						)
						.pipe(Effect.catchTag('SchemaError', Effect.die));
					return null;
				})
		),
		FunctionImpl.make(databaseSchema, messages, 'list', () =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const recent = yield* Effect.promise(() =>
					ctx.db.query('messages').order('desc').take(100)
				);
				const chronological = recent.reverse();
				const authorIds = [...new Set(chronological.map((message) => message.userId))];
				const authors = new Map<string, { name: string; image?: string }>();
				if (authorIds.length > 0) {
					const result = yield* Effect.promise(() =>
						ctx.runQuery(components.betterAuth.adapter.findMany, {
							model: 'user',
							paginationOpts: { cursor: null, numItems: authorIds.length },
							where: [{ field: '_id', operator: 'in', value: authorIds }]
						})
					);
					for (const { _id, name, email, image } of result.page.flatMap((record: unknown) =>
						Option.toArray(authorOf(record))
					)) {
						authors.set(_id, { name: name ?? email ?? 'Anonymous', image: image ?? undefined });
					}
				}
				return chronological.map((message) => {
					const author = authors.get(message.userId);
					return {
						_id: message._id,
						_creationTime: message._creationTime,
						userId: message.userId,
						body: message.body,
						author: author?.name ?? 'Anonymous',
						authorImage: author?.image
					};
				});
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'markMessageSettled', ({ messageId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const message = yield* Effect.promise(() => ctx.db.get('messages', messageId));
				if (!message || message.quotaSettledAt !== undefined) return null;
				const owner = yield* Effect.promise(() =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: message.userId }],
						select: ['_id']
					})
				);
				if (!owner) return null;
				yield* Effect.promise(() =>
					ctx.db.patch('messages', messageId, { quotaSettledAt: Date.now() })
				);
				yield* Effect.promise(() => ensureCaptureStart(ctx, 'community'));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'removeMessage', ({ messageId }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const message = yield* Effect.promise(() => ctx.db.get('messages', messageId));
				if (message) yield* Effect.promise(() => ctx.db.delete('messages', messageId));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, messages, 'send', ({ body }) =>
			Effect.gen(function* () {
				if (body.length > MAX_MESSAGE_LENGTH) {
					return yield* Effect.fail(new CommunityRefusal({ maxLength: MAX_MESSAGE_LENGTH }));
				}
				yield* Effect.sync(requireBillingConfiguration);
				const { _id: userId } = yield* CurrentUser;
				const ctx = yield* MutationCtx;
				const status = yield* Effect.promise(() =>
					appRateLimiter.limit(ctx, 'communityMessage', { key: userId })
				);
				if (!status.ok)
					return yield* Effect.fail(new RateLimited({ retryAfter: status.retryAfter }));
				const messageId = yield* Effect.promise(() => ctx.db.insert('messages', { body, userId }));
				yield* (yield* Scheduler).runAfter(
					Duration.zero,
					refs.internal.messages.enforceAndTrackMessageUsage,
					{ userId, messageId }
				);
				return { messageId };
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
