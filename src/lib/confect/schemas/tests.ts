import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

const Secret = { secret: Schema.String };
const ByEmail = { email: Schema.String, secret: Schema.String };

export const OwnedFixtureSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal('auditLog'),
		token: Schema.String,
		fixtureId: Schema.String
	}),
	Schema.Struct({ kind: Schema.Literal('aiChatHistory'), token: Schema.String }),
	Schema.Struct({ kind: Schema.Literal('supportNotification'), token: Schema.String })
]);

export const SeedSupportNotificationClaimArgs = Schema.Struct({
	...Secret,
	fixtureToken: Schema.String
});
export const SeedSupportNotificationClaimReturns = Schema.Struct({
	notificationId: Id('pendingAdminNotifications'),
	generation: Schema.String,
	claimToken: Schema.String,
	deadline: Schema.Number
});

export const RecoverSupportNotificationFixtureArgs = Schema.Struct({
	...Secret,
	notificationId: Id('pendingAdminNotifications'),
	generation: Schema.String,
	claimToken: Schema.String
});
export const RecoverSupportNotificationFixtureReturns = Schema.Struct({
	recovered: Schema.Boolean,
	duplicateRecovered: Schema.Boolean,
	staleDeleted: Schema.Boolean,
	retryCount: Schema.Number,
	sameGeneration: Schema.Boolean,
	scheduled: Schema.Boolean,
	claimCleared: Schema.Boolean
});

export const DeleteSupportNotificationFixtureArgs = Schema.Struct({
	...Secret,
	notificationId: Id('pendingAdminNotifications')
});

export const HealthArgs = Schema.Struct(Secret);
export const HealthReturns = Schema.Struct({ ok: Schema.Boolean });

export const SeedAiChatHistoryRowsArgs = Schema.Struct({
	...Secret,
	fixtureToken: Schema.String,
	userId: Schema.String,
	rows: Schema.Array(
		Schema.Struct({
			threadId: Schema.String,
			createdAt: Schema.Number,
			isWarm: Schema.optionalKey(Schema.Boolean),
			lastMessage: Schema.optionalKey(Schema.String),
			lastMessageAt: Schema.optionalKey(Schema.Number)
		})
	)
});
export const AiChatThreadIds = Schema.Array(Id('aiChatThreads'));
export const DeleteAiChatHistoryRowsArgs = Schema.Struct({ ...Secret, ids: AiChatThreadIds });

export const SeedAuditLogRowsArgs = Schema.Struct({
	...Secret,
	fixtureToken: Schema.String,
	fixtureId: Schema.String,
	count: Schema.Number,
	offset: Schema.Number,
	reasonBytes: Schema.optionalKey(Schema.Number)
});
export const AuditLogIds = Schema.Array(Id('adminAuditLogs'));
export const DeleteAuditLogRowsArgs = Schema.Struct({ ...Secret, ids: AuditLogIds });

export const GetLegacyAuditLogCursorArgs = Schema.Struct({
	...Secret,
	fixtureId: Schema.String,
	direction: Schema.Literals(['asc', 'desc'])
});

export const VerifyTestUserEmailArgs = Schema.Struct(ByEmail);
export const VerifyTestUserEmailReturns = Schema.Struct({
	success: Schema.Boolean,
	error: Schema.optional(Schema.String),
	alreadyVerified: Schema.optional(Schema.Boolean)
});

export const CreateTestAdminUserArgs = Schema.Struct(ByEmail);
export const CreateTestAdminUserReturns = Schema.Struct({
	success: Schema.Boolean,
	error: Schema.optional(Schema.String),
	alreadyAdmin: Schema.optional(Schema.Boolean),
	alreadyVerified: Schema.optional(Schema.Boolean),
	wasAdmin: Schema.optional(Schema.Boolean),
	wasVerified: Schema.optional(Schema.Boolean)
});

export const CreateAnonymousSupportThreadArgs = Schema.Struct({
	...Secret,
	anonymousUserId: Schema.String,
	title: Schema.optionalKey(Schema.String),
	pageUrl: Schema.optionalKey(Schema.String),
	count: Schema.optionalKey(Schema.Number)
});
export const CreateAnonymousSupportThreadReturns = Schema.Struct({
	threadIds: Schema.Array(Schema.String),
	anonymousUserId: Schema.String
});

export const CreateUnreadAnonymousSupportReplyArgs = Schema.Struct({
	...Secret,
	anonymousUserId: Schema.String,
	newerThreadCount: Schema.optionalKey(Schema.Number),
	messageRoute: Schema.optionalKey(Schema.String),
	messageAppVersion: Schema.optionalKey(Schema.String)
});
export const CreateUnreadAnonymousSupportReplyReturns = Schema.Struct({
	threadId: Schema.String,
	threadIds: Schema.Array(Schema.String),
	reply: Schema.String
});

export const GetSupportThreadsByUserIdArgs = Schema.Struct({ ...Secret, userId: Schema.String });
export const GetSupportThreadsByUserIdReturns = Schema.Array(
	Schema.Struct({
		threadId: Schema.String,
		userId: Schema.optional(Schema.String),
		userName: Schema.optional(Schema.String),
		userEmail: Schema.optional(Schema.String)
	})
);

export const GetAuthUserIdByEmailArgs = Schema.Struct({ ...Secret, email: Schema.String });
export const GetAuthUserIdByEmailReturns = Schema.Struct({ userId: Schema.NullOr(Schema.String) });

export const ResetAiChatFileUploadLimitArgs = Schema.Struct({ ...Secret, email: Schema.String });

export const GetPasswordResetTokenArgs = Schema.Struct(ByEmail);
export const GetPasswordResetTokenReturns = Schema.Struct({ token: Schema.NullOr(Schema.String) });

export const CleanupAnonymousSupportThreadsArgs = Schema.Struct({
	...Secret,
	threadIds: Schema.Array(Schema.String)
});
export const CleanupAnonymousSupportThreadsReturns = Schema.Struct({
	success: Schema.Boolean,
	deletedSupportThreads: Schema.Number,
	deletedAgentThreads: Schema.Number
});

export const DeleteTestUserArgs = Schema.Struct(ByEmail);
export const DeleteTestUserReturns = Schema.Struct({
	success: Schema.Boolean,
	error: Schema.optional(Schema.String),
	deletedEmail: Schema.optional(Schema.String),
	accountsDeleted: Schema.optional(Schema.Number),
	sessionsDeleted: Schema.optional(Schema.Number),
	verificationsDeleted: Schema.optional(Schema.Number)
});

export const CleanupTestDataArgs = Schema.Struct({
	...Secret,
	emails: Schema.optionalKey(Schema.Array(Schema.String))
});
export const CleanupTestDataReturns = Schema.Struct({
	success: Schema.Boolean,
	deletedCount: Schema.Number,
	message: Schema.String
});

export const DeleteOwnedFixtureArgs = Schema.Struct({ ...Secret, fixture: OwnedFixtureSchema });
export const DeleteOwnedFixtureReturns = Schema.Struct({ deleted: Schema.Number });

export const FindOwnedTestDataArgs = Schema.Struct({
	...Secret,
	userEmails: Schema.Array(Schema.String),
	recipientEmails: Schema.Array(Schema.String),
	supportOwners: Schema.Array(Schema.String),
	supportThreadIds: Schema.Array(Schema.String),
	fixtures: Schema.Array(OwnedFixtureSchema)
});
export const FindOwnedTestDataReturns = Schema.Struct({
	userEmails: Schema.Array(Schema.String),
	recipientEmails: Schema.Array(Schema.String),
	supportThreadOwners: Schema.Array(Schema.String),
	agentThreadIds: Schema.Array(Schema.String),
	fixtureTokens: Schema.Array(Schema.String)
});
