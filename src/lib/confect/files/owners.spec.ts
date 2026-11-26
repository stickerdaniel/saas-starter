import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'purge',
			args: () => ({ fileIds: Schema.Array(Schema.String) }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'record',
			args: () => ({ fileId: Schema.String, ownerId: Schema.String }),
			returns: () => Schema.Null
		})
	);
