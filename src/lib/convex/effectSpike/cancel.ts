/** T0 spike: `admin/customerNotifications/cancel.cancelUnsentEmails` on Confect. */
import { FunctionSpec, GroupSpec } from '@confect/core';
import {
	ConvexFunctionDefinitions,
	FunctionImpl,
	GroupImpl,
	RegisteredConvexFunction,
	type RegisteredFunctions
} from '@confect/server';
import type { EmailId } from '@convex-dev/resend';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import type { MutationCtx as AppMutationCtx } from '../_generated/server';
import { resend } from '../emails/resend';
import databaseSchema from '../../confect/schema';
import { MutationCtx } from '../../confect/services';

const spec = GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'cancelUnsentEmails',
		args: () => ({ emailIds: Schema.Array(Schema.String) }),
		returns: () => Schema.Null
	})
);

const cancelImpl = FunctionImpl.make(databaseSchema, spec, 'cancelUnsentEmails', ({ emailIds }) =>
	Effect.gen(function* () {
		// The Resend client takes a Convex ctx; Confect types it with its partial model.
		const ctx = (yield* MutationCtx) as unknown as AppMutationCtx;
		for (const emailId of emailIds) {
			const status = yield* Effect.promise(() => resend.status(ctx, emailId as EmailId));
			if (status?.status === 'waiting' || status?.status === 'queued') {
				yield* Effect.promise(() => resend.cancelEmail(ctx, emailId as EmailId));
			}
		}
		return null;
	})
);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof spec>(
	databaseSchema,
	GroupImpl.make(databaseSchema, spec).pipe(Layer.provide(cancelImpl), GroupImpl.finalize)
);
type Registered = RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof spec>;

export const cancelUnsentEmails = RegisteredConvexFunction.register(
	definitions.cancelUnsentEmails
) as Registered['cancelUnsentEmails'];
