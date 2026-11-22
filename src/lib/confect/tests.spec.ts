import { FunctionSpec, GroupSpec } from '@confect/core';
import type {
	cleanupAllTestUsers,
	cleanupAnonymousSupportThreads,
	cleanupTestData,
	createAnonymousSupportThread,
	createTestAdminUser,
	createUnreadAnonymousSupportReply,
	deleteAiChatHistoryRows,
	deleteAuditLogRows,
	deleteOwnedFixture,
	deleteSupportNotificationFixture,
	deleteTestUser,
	findOwnedTestData,
	getAuthUserIdByEmail,
	getLegacyAuditLogCursor,
	getPasswordResetToken,
	getSupportThreadsByUserId,
	getTestUser,
	health,
	recalculateDashboardCounters,
	recoverSupportNotificationFixture,
	resetAiChatFileUploadLimit,
	seedAiChatHistoryRows,
	seedAuditLogRows,
	seedSupportNotificationClaim,
	verifyTestUserEmail
} from './tests';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof cleanupAllTestUsers>()('cleanupAllTestUsers')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof cleanupAnonymousSupportThreads>()(
			'cleanupAnonymousSupportThreads'
		)
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof cleanupTestData>()('cleanupTestData'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof createAnonymousSupportThread>()(
			'createAnonymousSupportThread'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof createTestAdminUser>()('createTestAdminUser')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof createUnreadAnonymousSupportReply>()(
			'createUnreadAnonymousSupportReply'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof deleteAiChatHistoryRows>()('deleteAiChatHistoryRows')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof deleteAuditLogRows>()('deleteAuditLogRows'))
	.addFunction(FunctionSpec.convexPublicMutation<typeof deleteOwnedFixture>()('deleteOwnedFixture'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof deleteSupportNotificationFixture>()(
			'deleteSupportNotificationFixture'
		)
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof deleteTestUser>()('deleteTestUser'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof findOwnedTestData>()('findOwnedTestData'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof getAuthUserIdByEmail>()('getAuthUserIdByEmail')
	)
	.addFunction(
		FunctionSpec.convexPublicQuery<typeof getLegacyAuditLogCursor>()('getLegacyAuditLogCursor')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof getPasswordResetToken>()('getPasswordResetToken')
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof getSupportThreadsByUserId>()(
			'getSupportThreadsByUserId'
		)
	)
	.addFunction(FunctionSpec.convexInternalQuery<typeof getTestUser>()('getTestUser'))
	.addFunction(FunctionSpec.convexPublicQuery<typeof health>()('health'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof recalculateDashboardCounters>()(
			'recalculateDashboardCounters'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof recoverSupportNotificationFixture>()(
			'recoverSupportNotificationFixture'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof resetAiChatFileUploadLimit>()(
			'resetAiChatFileUploadLimit'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof seedAiChatHistoryRows>()('seedAiChatHistoryRows')
	)
	.addFunction(FunctionSpec.convexPublicMutation<typeof seedAuditLogRows>()('seedAuditLogRows'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof seedSupportNotificationClaim>()(
			'seedSupportNotificationClaim'
		)
	)
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof verifyTestUserEmail>()('verifyTestUserEmail')
	);
