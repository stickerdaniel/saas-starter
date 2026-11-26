import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { internal } from '../convex/_generated/api';
import type { Doc } from '../convex/_generated/dataModel';
import refs from './_generated/refs';
import databaseSchema from './_generated/schema';
import { MutationCtx, MutationRunner, QueryCtx, Scheduler } from './_generated/services';
import type { VerifiedAccess } from './oauth/access.spec';
import { appRateLimiter } from './rateLimit';
import type {
	DeleteOwnedFixtureArgs,
	DeleteSupportNotificationFixtureArgs,
	SeedSupportNotificationClaimArgs
} from './schemas/tests';
import {
	cleanupAnonymousSupportThreads,
	cleanupTestData,
	createAnonymousSupportThread,
	createTestAdminUser,
	createUnreadAnonymousSupportReply,
	deleteAiChatHistoryRows,
	deleteAuditLogRows,
	deleteTestUser,
	findOwnedTestData,
	getAuthUserIdByEmail,
	getLegacyAuditLogCursor,
	getPasswordResetToken,
	getSupportThreadsByUserId,
	recoverSupportNotificationFixture,
	resetAiChatFileUploadLimit,
	seedAiChatHistoryRows,
	seedAuditLogRows,
	verifyTestUserEmail,
	auditFixtureRows,
	aiHistoryFixtureRows,
	notificationFixtureRow,
	requireFixtureToken,
	supportRecoveryFixturePrefix
} from './tests';
import tests from './tests.spec';

const requireTestSecret = (secret: string) =>
	Effect.suspend(() => {
		const expected = process.env.AUTH_E2E_TEST_SECRET;
		return expected && secret === expected
			? Effect.void
			: Effect.die(new Error('Unauthorized: Invalid test secret'));
	});

const FIXTURE_SEND_DELAY = Duration.hours(1);

/** Cancels the fixture's own scheduled jobs and deletes its row; no other notification is touched. */
const deleteSupportRecoveryFixture = (row: Doc<'pendingAdminNotifications'>) =>
	Effect.gen(function* () {
		if (!row.threadId.startsWith(supportRecoveryFixturePrefix)) {
			return yield* Effect.die(new Error('Not a recovery fixture'));
		}
		const ctx = yield* MutationCtx;
		const scheduler = yield* Scheduler;
		for (const id of [row.scheduledFnId, row.recoveryFnId]) {
			const job = id ? yield* Effect.promise(() => ctx.db.system.get(id)) : null;
			if (id && job?.state.kind === 'pending') yield* scheduler.cancel(id);
		}
		yield* Effect.promise(() => ctx.db.delete('pendingAdminNotifications', row._id));
	});

const seedSupportNotificationClaim = (args: typeof SeedSupportNotificationClaimArgs.Type) =>
	Effect.gen(function* () {
		yield* Effect.sync(() => requireFixtureToken(args.fixtureToken));
		const ctx = yield* MutationCtx;
		const scheduler = yield* Scheduler;
		const now = Date.now();
		const notificationId = yield* Effect.promise(() =>
			ctx.db.insert('pendingAdminNotifications', {
				threadId: supportRecoveryFixturePrefix + args.fixtureToken,
				messageIds: [],
				isReopen: false,
				notificationType: 'newTickets',
				createdAt: now,
				scheduledFor: now + Duration.toMillis(FIXTURE_SEND_DELAY)
			})
		);
		const scheduledFnId = yield* scheduler.runAfter(
			FIXTURE_SEND_DELAY,
			refs.internal.admin.support.notifications.sendPendingAdminNotification,
			{ notificationId }
		);
		yield* Effect.promise(() =>
			ctx.db.patch('pendingAdminNotifications', notificationId, { scheduledFnId })
		);
		const claim = yield* (yield* MutationRunner)
			.runMutation(refs.internal.admin.support.notifications.claimNotificationForSending, {
				notificationId,
				issueToken: true,
				receiptProtocol: 1
			})
			.pipe(Effect.orDie);
		if (!claim) return yield* Effect.die(new Error('Fixture claim failed'));
		yield* scheduler.cancel(scheduledFnId);
		const row = yield* Effect.promise(() =>
			ctx.db.get('pendingAdminNotifications', notificationId)
		);
		const deadline = row?.claimLeaseExpiresAt;
		if (deadline === undefined) return yield* Effect.die(new Error('Fixture claim has no lease'));
		return {
			notificationId,
			generation: claim.generation,
			claimToken: claim.claimToken,
			deadline
		};
	});

const deleteSupportNotificationFixture = (args: typeof DeleteSupportNotificationFixtureArgs.Type) =>
	Effect.gen(function* () {
		const ctx = yield* MutationCtx;
		const row = yield* Effect.promise(() =>
			ctx.db.get('pendingAdminNotifications', args.notificationId)
		);
		if (row) yield* deleteSupportRecoveryFixture(row);
		return null;
	});

/** Deletes every row one registered fixture still holds; global teardown calls it per ledger entry. */
const deleteOwnedFixture = ({ fixture }: typeof DeleteOwnedFixtureArgs.Type) =>
	Effect.gen(function* () {
		yield* Effect.sync(() => requireFixtureToken(fixture.token));
		const ctx = yield* MutationCtx;
		switch (fixture.kind) {
			case 'auditLog': {
				const rows = yield* Effect.promise(() => auditFixtureRows(ctx, fixture));
				for (const row of rows)
					yield* Effect.promise(() => ctx.db.delete('adminAuditLogs', row._id));
				return { deleted: rows.length };
			}
			case 'aiChatHistory': {
				const rows = yield* Effect.promise(() => aiHistoryFixtureRows(ctx, fixture.token));
				for (const row of rows)
					yield* Effect.promise(() => ctx.db.delete('aiChatThreads', row._id));
				return { deleted: rows.length };
			}
			case 'supportNotification': {
				const row = yield* Effect.promise(() => notificationFixtureRow(ctx, fixture.token));
				if (row) yield* deleteSupportRecoveryFixture(row);
				return { deleted: row ? 1 : 0 };
			}
		}
	});

export default GroupImpl.make(databaseSchema, tests).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, tests, 'cleanupAnonymousSupportThreads', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => cleanupAnonymousSupportThreads(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'cleanupTestData', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => cleanupTestData(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'createAnonymousSupportThread', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => createAnonymousSupportThread(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'createTestAdminUser', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => createTestAdminUser(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'createUnreadAnonymousSupportReply', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => createUnreadAnonymousSupportReply(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteAiChatHistoryRows', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => deleteAiChatHistoryRows(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteAuditLogRows', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => deleteAuditLogRows(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteOwnedFixture', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				return yield* deleteOwnedFixture(args);
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteSupportNotificationFixture', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				return yield* deleteSupportNotificationFixture(args);
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'deleteTestUser', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => deleteTestUser(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'findOwnedTestData', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => findOwnedTestData(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'getAuthUserIdByEmail', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => getAuthUserIdByEmail(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'getLegacyAuditLogCursor', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => getLegacyAuditLogCursor(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'getPasswordResetToken', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => getPasswordResetToken(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'getSupportThreadsByUserId', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => getSupportThreadsByUserId(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'health', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				return { ok: true };
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'recoverSupportNotificationFixture', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => recoverSupportNotificationFixture(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'resetAiChatFileUploadLimit', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => resetAiChatFileUploadLimit(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'resetOAuthRegistrationLimit', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				yield* Effect.promise(() => appRateLimiter.reset(ctx, 'oauthClientRegistration'));
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'seedAiChatHistoryRows', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => seedAiChatHistoryRows(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'seedAuditLogRows', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => seedAuditLogRows(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'seedSupportNotificationClaim', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				return yield* seedSupportNotificationClaim(args);
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'verifyAccessToken', ({ secret, token, audiences }) =>
			Effect.gen(function* () {
				yield* requireTestSecret(secret);
				const ctx = yield* QueryCtx;
				return yield* Effect.promise((): Promise<typeof VerifiedAccess.Type> =>
					ctx.runQuery(internal.oauth.access.verify, { token, audiences: [...audiences] })
				);
			})
		),
		FunctionImpl.make(databaseSchema, tests, 'verifyTestUserEmail', (args) =>
			Effect.gen(function* () {
				yield* requireTestSecret(args.secret);
				const ctx = yield* MutationCtx;
				return yield* Effect.promise(() => verifyTestUserEmail(ctx, args));
			})
		)
	]),
	GroupImpl.finalize
);
