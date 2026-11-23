import * as Schema from 'effect/Schema';

export const AuditLogActionSchema = Schema.Literals([
	'impersonate',
	'stop_impersonation',
	'ban_user',
	'unban_user',
	'revoke_sessions',
	'set_role'
]);

export const AuditLogMetadataSchema = Schema.optional(
	Schema.Union([
		Schema.Struct({ reason: Schema.String }),
		Schema.Struct({ newRole: Schema.String, previousRole: Schema.String }),
		Schema.Struct({ durationMs: Schema.Number }),
		Schema.Struct({})
	])
);

export const AuditLogUserRefSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	email: Schema.optional(Schema.String),
	image: Schema.optional(Schema.String),
	exists: Schema.Boolean
});

export const AuditLogItemSchema = Schema.Struct({
	id: Schema.String,
	action: AuditLogActionSchema,
	timestamp: Schema.Number,
	metadata: AuditLogMetadataSchema,
	admin: AuditLogUserRefSchema,
	target: AuditLogUserRefSchema
});

const AuditLogSortSchema = Schema.Struct({
	field: Schema.Literal('timestamp'),
	direction: Schema.Literals(['asc', 'desc'])
});

const auditLogFilterFields = {
	actionFilter: Schema.optionalKey(AuditLogActionSchema),
	adminUserId: Schema.optionalKey(Schema.String),
	targetUserId: Schema.optionalKey(Schema.String)
};

export const ListAuditLogsArgsSchema = Schema.Struct({
	cursor: Schema.optionalKey(Schema.String),
	numItems: Schema.Number,
	search: Schema.optionalKey(Schema.String),
	sortBy: Schema.optionalKey(AuditLogSortSchema),
	...auditLogFilterFields
});

export const AuditLogCountArgsSchema = Schema.Struct({
	search: Schema.optionalKey(Schema.String),
	...auditLogFilterFields
});

export const AuditLogLastPageArgsSchema = Schema.Struct({
	numItems: Schema.Number,
	search: Schema.optionalKey(Schema.String),
	sortBy: Schema.optionalKey(AuditLogSortSchema),
	...auditLogFilterFields
});
