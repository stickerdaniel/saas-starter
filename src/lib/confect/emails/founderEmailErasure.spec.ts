import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'continueFounderEmailErasure',
			args: () => ({ userId: Schema.String, attempt: Schema.Number }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'eraseFounderEmailPage',
			args: () => ({ userId: Schema.String }),
			returns: () => Schema.Boolean
		})
	);
