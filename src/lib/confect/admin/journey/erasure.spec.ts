import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { ContinuationSchema, ErasurePageArgsSchema, ErasureRunSchema } from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'continueErasure',
			args: () => ErasureRunSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'erasePage',
			args: () => ErasurePageArgsSchema.fields,
			returns: () => Schema.Union([ContinuationSchema, Schema.Null])
		})
	);
