import { FunctionSpec, GroupSpec } from '@confect/core';
import { JourneyRequestFields, SupportFactsSchema } from '../schemas';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalQuery({
		name: 'read',
		args: () => JourneyRequestFields,
		returns: () => SupportFactsSchema
	})
);
