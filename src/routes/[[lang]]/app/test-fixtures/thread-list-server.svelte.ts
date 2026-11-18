import { getFunctionName, type FunctionReference } from 'convex/server';

/**
 * A stand-in for `convex-svelte` that serves `aiChat.threads.listThreads` only.
 *
 * Its `useQuery` follows the library's contract for this query: it subscribes
 * again whenever the args function returns a new limit, and while that limit's
 * result is pending it returns the last result only under `keepPreviousData`.
 * Every other query stays loading.
 */

export interface ThreadPage {
	threads: Array<{ _id: string; title?: string; lastMessageAt: number }>;
	hasMore: boolean;
}

// A changed limit closes the previous subscription before it opens the next.
let open: { limit: number; listener: (page: ThreadPage) => void } | undefined;

export const threadServer = {
	/** Every limit the layout subscribed with, in order. */
	requests: [] as number[],
	/** Answers the open subscription, which has to be the one for `limit`. */
	deliver(limit: number, page: ThreadPage): void {
		if (open?.limit !== limit)
			throw new Error(`No open listThreads subscription for limit ${limit}`);
		open.listener(page);
	},
	reset(): void {
		threadServer.requests = [];
		open = undefined;
	}
};

export function useQuery(
	query: FunctionReference<'query'>,
	args: () => { limit: number },
	options: { keepPreviousData?: boolean } = {}
): { readonly data: ThreadPage | undefined } {
	if (getFunctionName(query) !== 'aiChat/threads:listThreads') return { data: undefined };

	let latest = $state.raw<{ limit: number; page: ThreadPage }>();
	$effect(() => {
		const { limit } = args();
		threadServer.requests.push(limit);
		const subscription = {
			limit,
			listener: (page: ThreadPage) => {
				latest = { limit, page };
			}
		};
		open = subscription;
		return () => {
			if (open === subscription) open = undefined;
		};
	});
	return {
		get data() {
			if (latest?.limit === args().limit) return latest.page;
			return options.keepPreviousData ? latest?.page : undefined;
		}
	};
}

export function useConvexClient() {
	return { mutation: () => new Promise<never>(() => {}) };
}
