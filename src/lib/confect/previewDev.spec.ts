import { FunctionSpec, GroupSpec } from '@confect/core';
import { SeededAdminSchema } from './schemas/seededAdmin';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'ensurePreviewAdmin',
		args: () => ({}),
		returns: () => SeededAdminSchema
	})
);
