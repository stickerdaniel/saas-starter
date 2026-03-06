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
		throw new Error('Authentication required');
	}
	return identity;
}

export async function assertThreadOwnership(
	ctx: SupportAccessCtx,
	args: {
		threadId: string;
		anonymousUserId?: string;
	}
) {
	const thread = await supportAgent.getThreadMetadata(ctx, {
		threadId: args.threadId
	});
	const owner = await requireSupportOwnerIdentity(ctx, args.anonymousUserId);

	if (thread.userId !== owner.ownerId) {
		throw new Error("Unauthorized: Cannot access another user's thread");
	}

	return { thread, owner };
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
		throw new Error('Message not found');
	}

	const { thread, owner } = await assertThreadOwnership(ctx, {
		threadId: message.threadId,
		anonymousUserId: args.anonymousUserId
	});

	return { message, thread, owner };
}
