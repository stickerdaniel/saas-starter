import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { AdminSupportRefusalCodec } from '../../errorCodecs';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import {
	AdminReplyArgsSchema,
	InternalNoteArgsSchema,
	ThreadAssignmentArgsSchema,
	ThreadPriorityArgsSchema,
	ThreadStatusArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'addInternalUserNote',
			args: () => InternalNoteArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => AdminSupportRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'sendAdminReply',
			args: () => AdminReplyArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => AdminSupportRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateThreadAssignment',
			args: () => ThreadAssignmentArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => AdminSupportRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateThreadPriority',
			args: () => ThreadPriorityArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => AdminSupportRefusalCodec
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'updateThreadStatus',
			args: () => ThreadStatusArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => AdminSupportRefusalCodec
		}).middleware(RequireAdmin)
	);
