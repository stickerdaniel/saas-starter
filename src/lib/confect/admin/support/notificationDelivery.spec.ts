import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { ReceiptCleanupArgsSchema, RecipientEnqueueArgsSchema } from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'cleanupReceipts',
			args: () => ReceiptCleanupArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'enqueueRecipient',
			args: () => RecipientEnqueueArgsSchema.fields,
			returns: () => Schema.Boolean
		})
	);
