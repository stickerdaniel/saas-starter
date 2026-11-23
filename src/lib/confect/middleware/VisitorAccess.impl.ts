import { MiddlewareImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import databaseSchema from '../_generated/schema';
import { MutationCtx, QueryCtx } from '../_generated/services';
import { SupportAuthenticationRequired } from '../errorCodecs';
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
		Effect.flatMap((owner) =>
			owner ? Effect.succeed(owner) : Effect.fail(new SupportAuthenticationRequired())
		)
	);

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
