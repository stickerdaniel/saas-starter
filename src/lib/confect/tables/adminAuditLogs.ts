import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';
import { AuditLogActionSchema, AuditLogMetadataSchema } from '../admin/auditLog/schemas';

export default Table.make(() =>
	Schema.Struct({
		adminUserId: Schema.String,
		action: AuditLogActionSchema,
		targetUserId: Schema.String,
		metadata: AuditLogMetadataSchema,
		timestamp: Schema.Number
	})
)
	.index('by_admin', ['adminUserId'])
	.index('by_target', ['targetUserId'])
	.index('by_action', ['action'])
	.index('by_admin_action', ['adminUserId', 'action'])
	.index('by_target_action', ['targetUserId', 'action'])
	.index('by_timestamp', ['timestamp']);
