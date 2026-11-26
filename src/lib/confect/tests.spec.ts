import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import {
	AiChatThreadIds,
	AuditLogIds,
	CleanupAnonymousSupportThreadsArgs,
	CleanupAnonymousSupportThreadsReturns,
	CleanupTestDataArgs,
	CleanupTestDataReturns,
	CreateAnonymousSupportThreadArgs,
	CreateAnonymousSupportThreadReturns,
	CreateTestAdminUserArgs,
	CreateTestAdminUserReturns,
	CreateUnreadAnonymousSupportReplyArgs,
	CreateUnreadAnonymousSupportReplyReturns,
	DeleteAiChatHistoryRowsArgs,
	DeleteAuditLogRowsArgs,
	DeleteOwnedFixtureArgs,
	DeleteOwnedFixtureReturns,
	DeleteSupportNotificationFixtureArgs,
	DeleteTestUserArgs,
	DeleteTestUserReturns,
	FindOwnedTestDataArgs,
	FindOwnedTestDataReturns,
	GetAuthUserIdByEmailArgs,
	GetAuthUserIdByEmailReturns,
	GetLegacyAuditLogCursorArgs,
	GetPasswordResetTokenArgs,
	GetPasswordResetTokenReturns,
	GetSupportThreadsByUserIdArgs,
	GetSupportThreadsByUserIdReturns,
	HealthArgs,
	HealthReturns,
	RecoverSupportNotificationFixtureArgs,
	RecoverSupportNotificationFixtureReturns,
	ResetAiChatFileUploadLimitArgs,
	SeedAiChatHistoryRowsArgs,
	SeedAuditLogRowsArgs,
	SeedSupportNotificationClaimArgs,
	SeedSupportNotificationClaimReturns,
	VerifyTestUserEmailArgs,
	VerifyTestUserEmailReturns
} from './schemas/tests';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'cleanupAnonymousSupportThreads',
			args: () => CleanupAnonymousSupportThreadsArgs.fields,
			returns: () => CleanupAnonymousSupportThreadsReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'cleanupTestData',
			args: () => CleanupTestDataArgs.fields,
			returns: () => CleanupTestDataReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'createAnonymousSupportThread',
			args: () => CreateAnonymousSupportThreadArgs.fields,
			returns: () => CreateAnonymousSupportThreadReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'createTestAdminUser',
			args: () => CreateTestAdminUserArgs.fields,
			returns: () => CreateTestAdminUserReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'createUnreadAnonymousSupportReply',
			args: () => CreateUnreadAnonymousSupportReplyArgs.fields,
			returns: () => CreateUnreadAnonymousSupportReplyReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'deleteAiChatHistoryRows',
			args: () => DeleteAiChatHistoryRowsArgs.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'deleteAuditLogRows',
			args: () => DeleteAuditLogRowsArgs.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'deleteOwnedFixture',
			args: () => DeleteOwnedFixtureArgs.fields,
			returns: () => DeleteOwnedFixtureReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'deleteSupportNotificationFixture',
			args: () => DeleteSupportNotificationFixtureArgs.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'deleteTestUser',
			args: () => DeleteTestUserArgs.fields,
			returns: () => DeleteTestUserReturns
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'findOwnedTestData',
			args: () => FindOwnedTestDataArgs.fields,
			returns: () => FindOwnedTestDataReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'getAuthUserIdByEmail',
			args: () => GetAuthUserIdByEmailArgs.fields,
			returns: () => GetAuthUserIdByEmailReturns
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getLegacyAuditLogCursor',
			args: () => GetLegacyAuditLogCursorArgs.fields,
			returns: () => Schema.String
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'getPasswordResetToken',
			args: () => GetPasswordResetTokenArgs.fields,
			returns: () => GetPasswordResetTokenReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'getSupportThreadsByUserId',
			args: () => GetSupportThreadsByUserIdArgs.fields,
			returns: () => GetSupportThreadsByUserIdReturns
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'health',
			args: () => HealthArgs.fields,
			returns: () => HealthReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'recoverSupportNotificationFixture',
			args: () => RecoverSupportNotificationFixtureArgs.fields,
			returns: () => RecoverSupportNotificationFixtureReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'resetAiChatFileUploadLimit',
			args: () => ResetAiChatFileUploadLimitArgs.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'resetOAuthRegistrationLimit',
			args: () => ({ secret: Schema.String }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'seedAiChatHistoryRows',
			args: () => SeedAiChatHistoryRowsArgs.fields,
			returns: () => AiChatThreadIds
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'seedAuditLogRows',
			args: () => SeedAuditLogRowsArgs.fields,
			returns: () => AuditLogIds
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'seedSupportNotificationClaim',
			args: () => SeedSupportNotificationClaimArgs.fields,
			returns: () => SeedSupportNotificationClaimReturns
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'verifyTestUserEmail',
			args: () => VerifyTestUserEmailArgs.fields,
			returns: () => VerifyTestUserEmailReturns
		})
	);
