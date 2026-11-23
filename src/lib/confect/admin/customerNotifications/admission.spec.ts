import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { CurrentSchema, PaymentSchema } from './billing';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'admitObservation',
		args: () => ({
			userId: Schema.String,
			firstPayment: Schema.NullOr(PaymentSchema),
			current: Schema.NullOr(CurrentSchema),
			observedAt: Schema.Number
		}),
		returns: () => Schema.Null
	})
);
