import { Table } from '@confect/core';
import * as Schema from 'effect/Schema';

export default Table.make(() =>
	Schema.Struct({
		adminUserId: Schema.String,
		action: Schema.Literals([
			'impersonate',
			'stop_impersonation',
			'ban_user',
			'unban_user',
			'revoke_sessions',
			'set_role'
		]),
		targetUserId: Schema.String,
		metadata: Schema.optional(
			Schema.Union([
				Schema.Struct({ reason: Schema.String }),
				Schema.Struct({ newRole: Schema.String, previousRole: Schema.String }),
				Schema.Struct({ durationMs: Schema.Number }),
				Schema.Struct({})
			])
		),
		timestamp: Schema.Number
	})
)
	.index('by_admin', ['adminUserId'])
	.index('by_target', ['targetUserId'])
	.index('by_action', ['action'])
	.index('by_admin_action', ['adminUserId', 'action'])
	.index('by_target_action', ['targetUserId', 'action'])
	.index('by_timestamp', ['timestamp']);
