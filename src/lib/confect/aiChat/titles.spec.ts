import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { TitleArgsSchema } from './schemas';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalAction({
		name: 'generateThreadTitle',
		args: () => TitleArgsSchema.fields,
		returns: () => Schema.Null
	})
);
