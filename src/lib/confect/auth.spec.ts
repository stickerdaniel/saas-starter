import { FunctionSpec, GroupSpec } from '@confect/core';
import type { getAvailableOAuthProviders, onCreate, onDelete, onUpdate } from './authServer';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getAvailableOAuthProviders>()(
			'getAvailableOAuthProviders'
		)
	)
	.addFunction(FunctionSpec.convexInternalMutation<typeof onCreate>()('onCreate'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof onDelete>()('onDelete'))
	.addFunction(FunctionSpec.convexInternalMutation<typeof onUpdate>()('onUpdate'));
