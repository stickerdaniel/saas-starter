import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	addCustomEmail,
	removeCustomEmail,
	syncAllAdminPreferences,
	updatePreference,
	updatePreferences
} from './mutations';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicMutation<typeof addCustomEmail>()('addCustomEmail'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof removeCustomEmail>()('removeCustomEmail'))
	.addFunction(
		FunctionSpec.convexInternalMutation<typeof syncAllAdminPreferences>()('syncAllAdminPreferences')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof updatePreference>()('updatePreference'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof updatePreferences>()('updatePreferences'));
