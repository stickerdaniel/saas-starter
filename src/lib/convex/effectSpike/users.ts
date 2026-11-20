/** T0 spike: `users.getPasskeyNudgeDismissal` on Confect. */
import { FunctionSpec, GroupSpec } from '@confect/core';
import {
	ConvexFunctionDefinitions,
	FunctionImpl,
	GroupImpl,
	RegisteredConvexFunction,
	type RegisteredFunctions
} from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import { CurrentUser, RequireUser, RequireUserImpl } from '../../confect/auth';
import databaseSchema from '../../confect/schema';
import { DatabaseReader } from '../../confect/services';

const spec = GroupSpec.make().addFunction(
	FunctionSpec.publicQuery({
		name: 'passkeyNudgeDismissal',
		returns: () => Schema.Finite
	}).middleware(RequireUser)
);

const passkeyNudgeDismissalImpl = FunctionImpl.make(
	databaseSchema,
	spec,
	'passkeyNudgeDismissal',
	() =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const reader = yield* DatabaseReader;
			const dismissal = yield* reader
				.table('passkeyNudgeDismissals')
				.index('by_userId', (q) => q.eq('userId', user._id))
				.first()
				.pipe(Effect.orDie);
			return Option.match(dismissal, { onNone: () => 0, onSome: (row) => row.deferredUntil });
		})
);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof spec>(
	databaseSchema,
	GroupImpl.make(databaseSchema, spec).pipe(
		Layer.provide(passkeyNudgeDismissalImpl),
		Layer.provide(RequireUserImpl),
		GroupImpl.finalize
	)
);
type Registered = RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof spec>;

export const passkeyNudgeDismissal = RegisteredConvexFunction.register(
	definitions.passkeyNudgeDismissal
) as Registered['passkeyNudgeDismissal'];
