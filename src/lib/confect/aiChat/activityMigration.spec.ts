import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	MigrationPageArgsSchema,
	MigrationProgressSchema,
	MigrationStartArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'runPage',
			args: () => MigrationPageArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'start',
			args: () => MigrationStartArgsSchema.fields,
			returns: () => MigrationProgressSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'status',
			args: () => ({}),
			returns: () => Schema.NullOr(MigrationProgressSchema)
		})
	);
