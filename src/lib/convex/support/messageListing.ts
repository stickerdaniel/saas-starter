import { listUIMessages, syncStreams } from '@convex-dev/agent';
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';

type MessagePaginationArgs = {
	numItems: number;
	cursor: string | null;
};

type MessageStreamArgs =
	| {
			kind: 'list';
			startOrder?: number;
	  }
	| {
			kind: 'deltas';
			cursors: Array<{
				streamId: string;
				cursor: number;
			}>;
	  };

type RawMessageRow = {
	_id: string;
	provider?: string;
	providerMetadata?: Record<string, unknown>;
};

export async function listMessagesForThread(
	ctx: QueryCtx,
	args: {
		threadId: string;
		paginationOpts: MessagePaginationArgs;
		streamArgs?: MessageStreamArgs;
	}
): Promise<unknown> {
	const paginated = await listUIMessages(ctx, components.agent, {
		threadId: args.threadId,
		paginationOpts: args.paginationOpts
	});

	let rawMessages: { page: Array<RawMessageRow> } = {
		page: []
	};
	if (args.paginationOpts.numItems > 0) {
		rawMessages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
			threadId: args.threadId,
			paginationOpts: args.paginationOpts,
			order: 'asc'
		});
	}

	const metadataMap = new Map<string, Record<string, unknown>>();
	for (const rawMsg of rawMessages.page) {
		if (rawMsg.provider || rawMsg.providerMetadata) {
			metadataMap.set(rawMsg._id, {
				provider: rawMsg.provider,
				providerMetadata: rawMsg.providerMetadata
			});
		}
	}

	const enrichedPage = paginated.page.map((msg) => ({
		...msg,
		metadata: metadataMap.get(msg.id)
	}));

	const streamArgs =
		args.streamArgs?.kind === 'list'
			? {
					kind: 'list' as const,
					startOrder: args.streamArgs.startOrder ?? 0
				}
			: (args.streamArgs ?? { kind: 'list' as const, startOrder: 0 });

	const streams = await syncStreams(ctx, components.agent, {
		threadId: args.threadId,
		streamArgs,
		includeStatuses: ['streaming', 'finished', 'aborted']
	});

	return { ...paginated, page: enrichedPage, streams };
}
