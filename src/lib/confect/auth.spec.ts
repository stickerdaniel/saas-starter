import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import type { onCreate, onDelete, onUpdate } from './authServer';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getAvailableOAuthProviders',
			args: () => ({}),
			returns: () => Schema.Struct({ google: Schema.Boolean, github: Schema.Boolean })
		})
	)
	.addFunction(FunctionSpec.convexInternalMutation<typeof onCreate>()('onCreate'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof onDelete>()('onDelete'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof onUpdate>()('onUpdate'));
