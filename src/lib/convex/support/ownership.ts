import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { supportAgent } from './agent';
import { isAnonymousUser } from '../utils/anonymousUser';

type SupportAccessCtx = QueryCtx | MutationCtx;

export type SupportOwnerIdentity = {
	ownerId: string;
	anonymousUserId?: string;
	isAnonymous: boolean;
};

export async function getSupportOwnerIdentity(
	ctx: SupportAccessCtx,
	anonymousUserId?: string
): Promise<SupportOwnerIdentity | null> {
	const authUser = await authComponent.safeGetAuthUser(ctx);
	if (authUser) {
		return {
			ownerId: authUser._id,
			isAnonymous: false
		};
	}

	if (anonymousUserId && isAnonymousUser(anonymousUserId)) {
		return {
			ownerId: anonymousUserId,
			anonymousUserId,
			isAnonymous: true
		};
	}

	return null;
}

export async function requireSupportOwnerIdentity(
	ctx: SupportAccessCtx,
	anonymousUserId?: string
): Promise<SupportOwnerIdentity> {
	const identity = await getSupportOwnerIdentity(ctx, anonymousUserId);
	if (!identity) {
		throw new ConvexError('Authentication required');
	}
	return identity;
}

export async function requireSupportThreadRecord(
	ctx: SupportAccessCtx,
	args: {
		threadId: string;
		anonymousUserId?: string;
	}
) {
	const supportThread = await ctx.db
		.query('supportThreads')
		.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
		.first();
	if (!supportThread) {
		throw new ConvexError('Support thread not found');
	}

	const owner = await requireSupportOwnerIdentity(ctx, args.anonymousUserId);

	if (supportThread.userId !== owner.ownerId) {
		throw new ConvexError("Unauthorized: Cannot access another user's thread");
	}

	return { supportThread, owner };
}

export async function requireSupportThreadAccess(
	ctx: SupportAccessCtx,
	args: {
		threadId: string;
		anonymousUserId?: string;
	}
) {
	const { supportThread, owner } = await requireSupportThreadRecord(ctx, args);

	let thread;
	try {
		thread = await supportAgent.getThreadMetadata(ctx, {
			threadId: args.threadId
		});
	} catch {
		throw new ConvexError('Support thread not found');
	}

	return { supportThread, thread, owner };
}

type AgentMessageLookupResult = {
	threadId: string;
};

export async function assertMessageOwnership(
	ctx: SupportAccessCtx,
	args: {
		messageId: string;
		anonymousUserId?: string;
	}
) {
	const [message] = (await ctx.runQuery(components.agent.messages.getMessagesByIds, {
		messageIds: [args.messageId]
	})) as Array<AgentMessageLookupResult | null>;

	if (!message) {
		throw new ConvexError('Message not found');
	}

	const { supportThread, thread, owner } = await requireSupportThreadAccess(ctx, {
		threadId: message.threadId,
		anonymousUserId: args.anonymousUserId
	});

	return { message, supportThread, thread, owner };
}
