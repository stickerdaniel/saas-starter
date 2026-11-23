import { getFile, saveMessage } from '@convex-dev/agent';
import { FunctionImpl, GroupImpl } from '@confect/server';
import type { AssistantContent, FilePart, TextPart } from 'ai';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../../../convex/_generated/api';
import type { MutationCtx as ConvexMutationCtx } from '../../../convex/_generated/server';
import refs from '../../_generated/refs';
import databaseSchema from '../../_generated/schema';
import { MutationCtx, Scheduler } from '../../_generated/services';
import { MAX_MESSAGE_LENGTH } from '../../constants';
import { AdminSupportRefusal } from '../../errorCodecs';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import { CurrentUser } from '../../middleware/RequireUser.spec';
import { shouldSendNotification, syncSupportLastMessage } from '../../support/threads';
import { ADMIN_SUPPORT_ERROR_CODES } from './errors';
import mutations from './mutations.spec';
import type {
	AdminReplyArgsSchema,
	InternalNoteArgsSchema,
	ThreadAssignmentArgsSchema,
	ThreadPriorityArgsSchema,
	ThreadStatusArgsSchema
} from './schemas';

const EMAIL_REPLY_PREVIEW_CHARACTERS = 200;

function emailReplyPreview(message: string): string {
	const characters = Array.from(message.trim());
	if (characters.length <= EMAIL_REPLY_PREVIEW_CHARACTERS) return characters.join('');

	return `${characters
		.slice(0, EMAIL_REPLY_PREVIEW_CHARACTERS - 1)
		.join('')
		.trimEnd()}…`;
}

const withCtx = <A>(run: (ctx: ConvexMutationCtx) => Promise<A>) =>
	MutationCtx.use((ctx) => Effect.promise(() => run(ctx)));

const refuse = (refusal: AdminSupportRefusal['refusal']) =>
	Effect.fail(new AdminSupportRefusal({ refusal }));

const requireSupportThread = (threadId: string) =>
	Effect.gen(function* () {
		const supportThread = yield* withCtx((ctx) =>
			ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', threadId))
				.first()
		);
		if (!supportThread) return yield* refuse({ code: ADMIN_SUPPORT_ERROR_CODES.threadNotFound });
		return supportThread;
	});

const cancelPendingNotification = (threadId: string) =>
	Effect.gen(function* () {
		yield* (yield* Scheduler).runAfter(
			Duration.zero,
			refs.internal.admin.support.notifications.cancelPendingNotification,
			{ threadId }
		);
	});

/**
 * Assign a thread to an admin, or unassign it without `adminUserId`. Any
 * supplied id, including an empty string, must name an admin: the picker only
 * offers admins, but the mutation is callable without it. Assigning cancels
 * the pending admin notification.
 */
const assignThread = ({ threadId, adminUserId }: typeof ThreadAssignmentArgsSchema.Type) =>
	Effect.gen(function* () {
		const supportThread = yield* requireSupportThread(threadId);
		if (adminUserId !== undefined) {
			const assignee = yield* withCtx(
				(ctx) =>
					ctx.runQuery(components.betterAuth.adapter.findOne, {
						model: 'user',
						where: [{ field: '_id', operator: 'eq', value: adminUserId }]
					}) as Promise<{ role?: string | null } | null>
			);
			if (assignee?.role !== 'admin') {
				return yield* refuse({ code: ADMIN_SUPPORT_ERROR_CODES.assigneeNotAdmin });
			}
		}
		yield* withCtx((ctx) =>
			ctx.db.patch('supportThreads', supportThread._id, {
				assignedTo: adminUserId,
				updatedAt: Date.now()
			})
		);
		if (adminUserId) yield* cancelPendingNotification(threadId);
		return null;
	});

/** Set a thread open or done. Closing it cancels the pending admin notification. */
const setThreadStatus = ({ threadId, status }: typeof ThreadStatusArgsSchema.Type) =>
	Effect.gen(function* () {
		const supportThread = yield* requireSupportThread(threadId);
		yield* withCtx((ctx) =>
			ctx.db.patch('supportThreads', supportThread._id, { status, updatedAt: Date.now() })
		);
		if (status === 'done') yield* cancelPendingNotification(threadId);
		return null;
	});

/** Set or clear the priority of a thread. */
const setThreadPriority = ({ threadId, priority }: typeof ThreadPriorityArgsSchema.Type) =>
	Effect.gen(function* () {
		const supportThread = yield* requireSupportThread(threadId);
		yield* withCtx((ctx) =>
			ctx.db.patch('supportThreads', supportThread._id, { priority, updatedAt: Date.now() })
		);
		return null;
	});

/**
 * Add a human admin message, distinct from an AI answer, without triggering
 * the AI. The first reply assigns the thread to the replying admin. The
 * customer gets an email when notifications are on and the cooldown has
 * passed, and the pending admin notification is cancelled.
 */
const replyAsAdmin = ({ threadId, prompt, fileIds }: typeof AdminReplyArgsSchema.Type) =>
	Effect.gen(function* () {
		if (!prompt.trim() && (!fileIds || fileIds.length === 0)) {
			return yield* refuse({ code: ADMIN_SUPPORT_ERROR_CODES.emptyMessage });
		}
		if (prompt.length > MAX_MESSAGE_LENGTH) {
			return yield* refuse({
				code: ADMIN_SUPPORT_ERROR_CODES.messageTooLong,
				maxLength: MAX_MESSAGE_LENGTH
			});
		}
		const supportThread = yield* requireSupportThread(threadId);
		const user = yield* CurrentUser;
		const replyTimestamp = Date.now();
		const adminName = user.name || user.email || 'Admin';

		const result = yield* withCtx(async (ctx) => {
			let messageContent: string | AssistantContent = prompt.trim();
			if (fileIds && fileIds.length > 0) {
				const content: Array<TextPart | FilePart> = [];
				if (prompt.trim()) content.push({ type: 'text', text: prompt.trim() });
				for (const fileId of fileIds) {
					const { filePart } = await getFile(ctx, components.agent, fileId);
					content.push(filePart);
				}
				messageContent = content;
			}
			// Standalone saveMessage sets the admin as agentName; Agent.saveMessage uses the agent's name.
			return saveMessage(ctx, components.agent, {
				threadId,
				agentName: adminName,
				message: { role: 'assistant', content: messageContent },
				metadata: {
					provider: 'human',
					providerMetadata: {
						admin: {
							isAdminMessage: true,
							adminUserId: user._id,
							adminName,
							adminEmail: user.email
						}
					},
					...(fileIds?.length ? { fileIds } : {})
				}
			});
		});

		// An assigned thread is human-only: user messages no longer trigger the AI.
		const shouldAutoAssign = !supportThread.assignedTo;
		const shouldNotify = shouldSendNotification(
			supportThread.notificationEmail,
			supportThread.notificationSentAt
		);
		// A legacy unread thread has one known unread reply even though it predates
		// the numeric field. Convex OCC retries concurrent admin replies against
		// fresh state, so each committed reply increments exactly once.
		const unreadAdminReplyCount = supportThread.hasUnreadAdminReply
			? (supportThread.unreadAdminReplyCount ?? 1) + 1
			: 1;

		// The scheduled email mutation owns the cooldown timestamp, so only a
		// committed provider enqueue can consume it.
		yield* withCtx((ctx) =>
			ctx.db.patch('supportThreads', supportThread._id, {
				awaitingAdminResponse: false,
				lastAdminReplyAt: replyTimestamp,
				lastAdminReplyMessageId: result.messageId,
				hasUnreadAdminReply: true,
				unreadAdminReplyCount,
				updatedAt: replyTimestamp,
				...(shouldAutoAssign && { assignedTo: user._id })
			})
		);

		if (shouldNotify && supportThread.notificationEmail) {
			yield* (yield* Scheduler).runAfter(
				Duration.zero,
				refs.internal.emails.send.sendAdminReplyNotification,
				{
					supportThreadId: supportThread._id,
					email: supportThread.notificationEmail,
					adminName,
					messagePreview: emailReplyPreview(prompt),
					threadId: supportThread.threadId,
					pageUrl: supportThread.pageUrl
				}
			);
		}
		yield* cancelPendingNotification(threadId);
		yield* withCtx(async (ctx) => {
			await syncSupportLastMessage(ctx, threadId);
		});
		return null;
	});

/**
 * Add an internal note about a user, never shown to users. Notes are
 * user-level, for an authenticated user or an anonymous anon_* id, so they
 * appear across all threads of that user.
 */
const addNote = ({ userId, content }: typeof InternalNoteArgsSchema.Type) =>
	Effect.gen(function* () {
		if (!content.trim()) return yield* refuse({ code: ADMIN_SUPPORT_ERROR_CODES.emptyNote });
		const user = yield* CurrentUser;
		yield* withCtx((ctx) =>
			ctx.db.insert('internalUserNotes', {
				userId,
				adminUserId: user._id,
				content: content.trim(),
				createdAt: Date.now()
			})
		);
		return null;
	});

export default GroupImpl.make(databaseSchema, mutations).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, mutations, 'addInternalUserNote', (args) =>
			Effect.gen(function* () {
				return yield* addNote(args);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'sendAdminReply', (args) =>
			Effect.gen(function* () {
				return yield* replyAsAdmin(args);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updateThreadAssignment', (args) =>
			Effect.gen(function* () {
				return yield* assignThread(args);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updateThreadPriority', (args) =>
			Effect.gen(function* () {
				return yield* setThreadPriority(args);
			})
		),
		FunctionImpl.make(databaseSchema, mutations, 'updateThreadStatus', (args) =>
			Effect.gen(function* () {
				return yield* setThreadStatus(args);
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
