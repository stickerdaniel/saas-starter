import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import RequireAdmin from '../../middleware/RequireAdmin.spec';
import {
	AuditLogCountArgsSchema,
	AuditLogItemSchema,
	AuditLogLastPageArgsSchema,
	AuditLogUserRefSchema,
	ListAuditLogsArgsSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getAuditLogCount',
			args: () => AuditLogCountArgsSchema.fields,
			returns: () => Schema.Number
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listAuditLogs',
			args: () => ListAuditLogsArgsSchema.fields,
			returns: () =>
				Schema.Struct({
					items: Schema.mutable(Schema.Array(AuditLogItemSchema)),
					continueCursor: Schema.NullOr(Schema.String),
					isDone: Schema.Boolean
				})
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'resolveAuditLogLastPage',
			args: () => AuditLogLastPageArgsSchema.fields,
			returns: () => Schema.Struct({ page: Schema.Number, cursor: Schema.NullOr(Schema.String) })
		}).middleware(RequireAdmin)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'resolveAuditLogUser',
			args: () => ({ userId: Schema.String }),
			returns: () => AuditLogUserRefSchema
		}).middleware(RequireAdmin)
	);
