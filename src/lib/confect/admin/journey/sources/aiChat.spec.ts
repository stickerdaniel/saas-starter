import { FunctionSpec, GroupSpec } from '@confect/core';
import { JourneyRequestFields, PartitionedFactsSchema } from '../schemas';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalQuery({
		name: 'read',
		args: () => JourneyRequestFields,
		returns: () => PartitionedFactsSchema
	})
);
