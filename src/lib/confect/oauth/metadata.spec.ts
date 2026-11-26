import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalQuery({
		name: 'authorizationServer',
		args: () => ({}),
		returns: () => Schema.Record(Schema.String, Schema.Unknown)
	})
);
