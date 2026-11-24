import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { HandoffArgsSchema, UnansweredTurnSchema } from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'internalSetHandoff',
			args: () => HandoffArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'settleUnansweredTurn',
			args: () => UnansweredTurnSchema.fields,
			returns: () => Schema.Null
		})
	);
