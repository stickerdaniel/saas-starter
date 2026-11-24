import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { SupportRefusalCodec } from '../errorCodecs';
import VisitorAccess from '../middleware/VisitorAccess.spec';
import { SupportOwnerArgsSchema, ThreadReadArgsSchema } from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'hasUnreadAdminReply',
			args: () => SupportOwnerArgsSchema.fields,
			returns: () => Schema.Boolean
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'markThreadRead',
			args: () => ThreadReadArgsSchema.fields,
			returns: () => Schema.Null,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'unreadAdminReplyCount',
			args: () => SupportOwnerArgsSchema.fields,
			returns: () => Schema.Number
		}).middleware(VisitorAccess)
	);
