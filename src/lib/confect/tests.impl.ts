import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import {
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
import tests from './tests.spec';

export default GroupImpl.make(databaseSchema, tests).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, tests, 'cleanupAllTestUsers', cleanupAllTestUsers),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'cleanupAnonymousSupportThreads',
			cleanupAnonymousSupportThreads
		),
		FunctionImpl.make(databaseSchema, tests, 'cleanupTestData', cleanupTestData),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'createAnonymousSupportThread',
			createAnonymousSupportThread
		),
		FunctionImpl.make(databaseSchema, tests, 'createTestAdminUser', createTestAdminUser),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'createUnreadAnonymousSupportReply',
			createUnreadAnonymousSupportReply
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteAiChatHistoryRows', deleteAiChatHistoryRows),
		FunctionImpl.make(databaseSchema, tests, 'deleteAuditLogRows', deleteAuditLogRows),
		FunctionImpl.make(databaseSchema, tests, 'deleteOwnedFixture', deleteOwnedFixture),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'deleteSupportNotificationFixture',
			deleteSupportNotificationFixture
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteTestUser', deleteTestUser),
		FunctionImpl.make(databaseSchema, tests, 'findOwnedTestData', findOwnedTestData),
		FunctionImpl.make(databaseSchema, tests, 'getAuthUserIdByEmail', getAuthUserIdByEmail),
		FunctionImpl.make(databaseSchema, tests, 'getLegacyAuditLogCursor', getLegacyAuditLogCursor),
		FunctionImpl.make(databaseSchema, tests, 'getPasswordResetToken', getPasswordResetToken),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'getSupportThreadsByUserId',
			getSupportThreadsByUserId
		),
		FunctionImpl.make(databaseSchema, tests, 'getTestUser', getTestUser),
		FunctionImpl.make(databaseSchema, tests, 'health', health),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'recalculateDashboardCounters',
			recalculateDashboardCounters
		),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'recoverSupportNotificationFixture',
			recoverSupportNotificationFixture
		),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'resetAiChatFileUploadLimit',
			resetAiChatFileUploadLimit
		),
		FunctionImpl.make(databaseSchema, tests, 'seedAiChatHistoryRows', seedAiChatHistoryRows),
		FunctionImpl.make(databaseSchema, tests, 'seedAuditLogRows', seedAuditLogRows),
		FunctionImpl.make(
			databaseSchema,
			tests,
			'seedSupportNotificationClaim',
			seedSupportNotificationClaim
		),
		FunctionImpl.make(databaseSchema, tests, 'verifyTestUserEmail', verifyTestUserEmail)
	]),
	GroupImpl.finalize
);
