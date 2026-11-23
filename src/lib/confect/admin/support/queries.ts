import * as Effect from 'effect/Effect';
import { components } from '../../../convex/_generated/api';
import type { QueryCtx as ConvexQueryCtx } from '../../../convex/_generated/server';
import { normalizeSupportAppVersion } from '../../../shared/support-app-version';
import { normalizeSupportPageRoute } from '../../../shared/support-page-route';
import { QueryCtx } from '../../_generated/services';
import { toAgentThreadStatus } from '../../support/denormalization';
import { listMessagesForThread } from '../../support/messageListing';
import { isAnonymousUser } from '../../utils/anonymousUser';
import { parseBetterAuthUsers } from '../types';
import {
	ADMIN_USERS_BATCH_SIZE,
	SUPPORT_MESSAGE_ROUTES_LIMIT,
	SUPPORT_THREADS_PAGE_SIZE
} from './constants';
import type {
	InternalNotesArgsSchema,
	MessageListArgsSchema,
	SupportPersonSchema,
	ThreadArgsSchema,
	ThreadListArgsSchema
} from './schemas';

type SupportPerson = typeof SupportPersonSchema.Type;
type AdapterPerson = { _id: string; name?: string; email?: string; image?: string | null };

const withQuery = <A>(run: (ctx: ConvexQueryCtx) => Promise<A>) =>
	QueryCtx.use((ctx) => Effect.promise(() => run(ctx)));

const requireSupportThread = (threadId: string) =>
	Effect.gen(function* () {
		const supportThread = yield* withQuery((ctx) =>
			ctx.db
				.query('supportThreads')
				.withIndex('by_thread', (q) => q.eq('threadId', threadId))
				.first()
		);
		if (!supportThread) {
			return yield* Effect.die(new Error(`Support thread not found for threadId: ${threadId}`));
		}
		return supportThread;
	});

const toSupportPerson = (person: AdapterPerson): SupportPerson => ({
	id: person._id,
	name: person.name,
	email: person.email,
	image: person.image ?? null
});

const findPerson = (ctx: ConvexQueryCtx, id: string) =>
	ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', operator: 'eq', value: id }],
		select: ['id', 'name', 'email', 'image']
	}) as Promise<AdapterPerson | null>;

function pageThreads(ctx: ConvexQueryCtx, args: typeof ThreadListArgsSchema.Type) {
	const paginationOpts = args.paginationOpts ?? {
		numItems: SUPPORT_THREADS_PAGE_SIZE,
		cursor: null
	};
	const statusFilter = args.status;
	const assignedToFilter = typeof args.filter === 'object' ? args.filter.assignedTo : undefined;
	const isUnassigned = args.filter === 'unassigned';
	const searchQuery = args.search?.trim();
	const threads = ctx.db.query('supportThreads');

	// Every path shows only threads that have been handed off to human support.
	if (searchQuery) {
		return threads
			.withSearchIndex('search_all', (q) => {
				let filter = q.search('searchText', searchQuery).eq('isHandedOff', true);
				if (statusFilter) filter = filter.eq('status', statusFilter);
				if (isUnassigned) filter = filter.eq('assignedTo', undefined);
				else if (assignedToFilter) filter = filter.eq('assignedTo', assignedToFilter);
				return filter;
			})
			.paginate(paginationOpts);
	}
	if (statusFilter && (isUnassigned || assignedToFilter)) {
		return threads
			.withIndex('by_handed_off_status_assigned_updated', (q) =>
				q.eq('isHandedOff', true).eq('status', statusFilter).eq('assignedTo', assignedToFilter)
			)
			.order('desc')
			.paginate(paginationOpts);
	}
	if (statusFilter) {
		return threads
			.withIndex('by_handed_off_status_updated', (q) =>
				q.eq('isHandedOff', true).eq('status', statusFilter)
			)
			.order('desc')
			.paginate(paginationOpts);
	}
	if (isUnassigned || assignedToFilter) {
		return threads
			.withIndex('by_handed_off_assigned_updated', (q) =>
				q.eq('isHandedOff', true).eq('assignedTo', assignedToFilter)
			)
			.order('desc')
			.paginate(paginationOpts);
	}
	return threads
		.withIndex('by_handed_off_updated', (q) => q.eq('isHandedOff', true))
		.order('desc')
		.paginate(paginationOpts);
}

/**
 * Threads with admin filters: assignment, status and search over title,
 * summary or message content. Non-search results are ordered by updatedAt;
 * search results use relevance order.
 */
export const readThreadsPage = (args: typeof ThreadListArgsSchema.Type) =>
	withQuery(async (ctx) => {
		const supportThreads = await pageThreads(ctx, args);

		const userIds = [
			...new Set(
				supportThreads.page
					.map((thread) => thread.userId)
					.filter((id): id is string => !!id && !isAnonymousUser(id))
			)
		];
		const userImageMap = new Map<string, string>();
		if (userIds.length > 0) {
			// `_id in` resolves only this page's owners and returns all matching point reads.
			const users = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				where: [{ field: '_id', operator: 'in', value: userIds }],
				paginationOpts: { cursor: null, numItems: userIds.length },
				select: ['_id', 'image']
			});
			for (const user of users.page as Array<{ _id: string; image?: string | null }>) {
				if (user.image) userImageMap.set(user._id, user.image);
			}
		}

		return {
			page: supportThreads.page.map((supportThread) => ({
				_id: supportThread.threadId,
				_creationTime: supportThread.createdAt,
				userId: supportThread.userId,
				title: supportThread.title,
				summary: supportThread.summary,
				status: toAgentThreadStatus(supportThread.status),
				supportMetadata: supportThread,
				lastMessage: supportThread.lastMessage,
				lastMessageAt: supportThread.lastMessageAt,
				userName: supportThread.userName,
				userEmail: supportThread.userEmail,
				userImage: supportThread.userId ? userImageMap.get(supportThread.userId) : undefined
			})),
			isDone: supportThreads.isDone,
			continueCursor: supportThreads.continueCursor
		};
	});

/** Thread details for the admin view, with the assigned admin and the owner. */
export const readThreadDetails = ({ threadId }: typeof ThreadArgsSchema.Type) =>
	Effect.gen(function* () {
		const supportThread = yield* requireSupportThread(threadId);
		return yield* withQuery(async (ctx) => {
			const admin = supportThread.assignedTo
				? await findPerson(ctx, supportThread.assignedTo)
				: null;

			let user: SupportPerson | undefined;
			if (supportThread.userId && !isAnonymousUser(supportThread.userId)) {
				try {
					const owner = await findPerson(ctx, supportThread.userId);
					if (owner) user = toSupportPerson(owner);
				} catch {
					console.error({ code: 'support_thread_user_unavailable', threadId });
				}
			}

			return {
				_id: supportThread.threadId,
				_creationTime: supportThread.createdAt,
				userId: supportThread.userId,
				title: supportThread.title,
				summary: supportThread.summary,
				status: toAgentThreadStatus(supportThread.status),
				supportMetadata: supportThread,
				assignedAdmin: admin ? toSupportPerson(admin) : undefined,
				user
			};
		});
	});

/**
 * The route each message in a thread was sent from, and the build that sent it.
 *
 * The thread's own pageUrl is captured before its first message, so the details
 * panel cannot account for messages sent after the visitor navigates elsewhere.
 * A row may hold either one: older rows have no build, and a build survives a
 * route that failed normalization.
 */
export const readMessageRoutes = ({ threadId }: typeof ThreadArgsSchema.Type) =>
	withQuery(async (ctx) => {
		const contexts = await ctx.db
			.query('supportMessageContexts')
			.withIndex('by_thread', (q) => q.eq('threadId', threadId))
			.order('desc')
			.take(SUPPORT_MESSAGE_ROUTES_LIMIT);

		return contexts.flatMap((context) => {
			const pageUrl = normalizeSupportPageRoute(context.pageUrl);
			const appVersion = normalizeSupportAppVersion(context.appVersion);
			if (!pageUrl && !appVersion) return [];
			return [
				{
					messageId: context.messageId,
					...(pageUrl ? { pageUrl } : {}),
					...(appVersion ? { appVersion } : {})
				}
			];
		});
	});

export const readMessages = (args: typeof MessageListArgsSchema.Type) =>
	Effect.gen(function* () {
		yield* requireSupportThread(args.threadId);
		return yield* withQuery((ctx) =>
			listMessagesForThread(ctx, {
				threadId: args.threadId,
				paginationOpts: args.paginationOpts,
				streamArgs: args.streamArgs
			})
		);
	});

/**
 * Internal notes about a user, an authenticated one or an anonymous anon_* id.
 * Notes are user-level, so they appear across all threads for that user.
 */
export const readInternalNotes = (args: typeof InternalNotesArgsSchema.Type) =>
	withQuery(async (ctx) => {
		const notes = await ctx.db
			.query('internalUserNotes')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.order('desc')
			.paginate(args.paginationOpts ?? { numItems: SUPPORT_THREADS_PAGE_SIZE, cursor: null });

		// Authors resolve by id, not by current role: a demoted admin keeps their notes' byline.
		const adminIds = [...new Set(notes.page.map((note) => note.adminUserId))];
		type AdminInfo = { _id: string; name?: string; email?: string };
		const adminMap = new Map<string, AdminInfo>();
		if (adminIds.length > 0) {
			// `_id in` resolves only this page's authors and returns all matching point reads.
			const authors = await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				where: [{ field: '_id', operator: 'in', value: adminIds }],
				paginationOpts: { cursor: null, numItems: adminIds.length },
				select: ['_id', 'name', 'email']
			});
			for (const author of authors.page as AdminInfo[]) {
				adminMap.set(author._id, author);
			}
		}

		return {
			page: notes.page.map((note) => {
				const admin = adminMap.get(note.adminUserId);
				return { ...note, adminName: admin?.name, adminEmail: admin?.email };
			}),
			isDone: notes.isDone,
			continueCursor: notes.continueCursor
		};
	});

/**
 * Threads awaiting an admin response, capped at 100 to avoid an unbounded
 * scan. The sidebar badge shows "99+" when the count is 100.
 */
export const countAwaitingResponse = withQuery(async (ctx) => {
	const awaitingThreads = await ctx.db
		.query('supportThreads')
		.withIndex('by_needs_response', (q) =>
			q.eq('isHandedOff', true).eq('status', 'open').eq('awaitingAdminResponse', true)
		)
		.take(100);
	return awaitingThreads.length;
});

/** Up to ADMIN_USERS_BATCH_SIZE admin users for the assignment dropdown. */
export const readAdmins = withQuery(async (ctx) => {
	const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'user',
		paginationOpts: { cursor: null, numItems: ADMIN_USERS_BATCH_SIZE },
		where: [{ field: 'role', operator: 'eq', value: 'admin' }]
	});
	return parseBetterAuthUsers(result.page).map(toSupportPerson);
});
