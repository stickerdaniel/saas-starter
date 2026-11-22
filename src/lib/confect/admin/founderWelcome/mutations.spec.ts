import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	setFounderEmailEnabled,
	stepDown,
	updateConfig,
	updateFounderEmailTemplate
} from './mutations';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof setFounderEmailEnabled>()('setFounderEmailEnabled')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof stepDown>()('stepDown'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof updateConfig>()('updateConfig'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateFounderEmailTemplate>()(
			'updateFounderEmailTemplate'
		)
	);
