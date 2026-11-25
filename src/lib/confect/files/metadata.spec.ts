import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';
import { FileReferenceFields } from './schemas';

export default GroupSpec.make().addFunction(
	FunctionSpec.internalMutation({
		name: 'storeFileMetadata',
		args: () => ({
			...FileReferenceFields,
			url: Schema.String,
			width: Schema.Number,
			height: Schema.Number
		}),
		returns: () => Id('fileMetadata')
	})
);
