import { MiddlewareImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import type { QueryCtx as ConvexQueryCtx } from '../../convex/_generated/server';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import { SupportRefusal, type SupportRefusalCode } from '../errorCodecs';
import { SUPPORT_ERROR_CODES } from '../support/errors';
import { getSupportOwnerIdentity } from '../support/ownership';
import VisitorAccess, { SupportOwner } from './VisitorAccess.spec';

const anonymousUserId = (args: unknown) =>
	typeof args === 'object' &&
	args !== null &&
	'anonymousUserId' in args &&
	typeof args.anonymousUserId === 'string'
		? args.anonymousUserId
		: undefined;

const supportOwner = (ctx: Parameters<typeof getSupportOwnerIdentity>[0], args: unknown) =>
	Effect.promise(() => getSupportOwnerIdentity(ctx, anonymousUserId(args))).pipe(
		Effect.map(Option.fromNullishOr)
	);

const refuse = (code: SupportRefusalCode) => Effect.fail(new SupportRefusal({ refusal: { code } }));

export const requireOwnedSupportThread = (db: ConvexQueryCtx['db'], threadId: string) =>
	Effect.gen(function* () {
		const supportThread = yield* Effect.promise(() =>
			db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', threadId))
				.first()
		);
		if (!supportThread) return yield* refuse(SUPPORT_ERROR_CODES.threadNotFound);
		const owner = yield* SupportOwner;
		if (Option.isNone(owner)) return yield* refuse(SUPPORT_ERROR_CODES.authenticationRequired);
		if (supportThread.userId !== owner.value.ownerId) {
			return yield* refuse(SUPPORT_ERROR_CODES.threadForbidden);
		}
		return { supportThread, owner: owner.value };
	});

export default MiddlewareImpl.makeByFunctionType(databaseSchema, VisitorAccess, {
	query: (effect, { invocation }) =>
		Effect.provideServiceEffect(
			effect,
			SupportOwner,
			QueryCtx.use((ctx) => supportOwner(ctx, invocation.args))
		),
	mutation: (effect, { invocation }) =>
		Effect.provideServiceEffect(
			effect,
			SupportOwner,
			MutationCtx.use((ctx) => supportOwner(ctx, invocation.args))
		)
});
