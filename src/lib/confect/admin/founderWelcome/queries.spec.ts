import { FunctionSpec, GroupSpec } from '@confect/core';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import {
	FounderEmailSettingsSchema,
	FounderWelcomeAdminConfigSchema,
	FounderWelcomeConfigSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getFounderEmailSettings',
			args: () => ({}),
			returns: () => FounderEmailSettingsSchema
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getFounderWelcomeConfig',
			args: () => ({}),
			returns: () => FounderWelcomeAdminConfigSchema
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getFounderWelcomeConfigInternal',
			args: () => ({}),
			returns: () => FounderWelcomeConfigSchema
		})
	);
