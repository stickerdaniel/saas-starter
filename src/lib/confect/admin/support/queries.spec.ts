import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import {
	InternalNotesArgsSchema,
	InternalNotesSchema,
	MessageListArgsSchema,
	MessageListSchema,
	MessageRoutesSchema,
	SupportPersonSchema,
	ThreadArgsSchema,
	ThreadDetailsSchema,
	ThreadListArgsSchema,
	ThreadListSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getAwaitingResponseCount',
			args: () => ({}),
			returns: () => Schema.Number
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getThreadForAdmin',
			args: () => ThreadArgsSchema.fields,
			returns: () => ThreadDetailsSchema
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listAdmins',
			args: () => ({}),
			returns: () => Schema.mutable(Schema.Array(SupportPersonSchema))
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listInternalUserNotes',
			args: () => InternalNotesArgsSchema.fields,
			returns: () => InternalNotesSchema
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listMessageRoutesForAdmin',
			args: () => ThreadArgsSchema.fields,
			returns: () => MessageRoutesSchema
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listMessagesForAdmin',
			args: () => MessageListArgsSchema.fields,
			returns: () => MessageListSchema
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listThreadsForAdmin',
			args: () => ThreadListArgsSchema.fields,
			returns: () => ThreadListSchema
		}).middleware(RequireAdmin)
	);
