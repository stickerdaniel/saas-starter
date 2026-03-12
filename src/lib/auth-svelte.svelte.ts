import { browser } from '$app/environment';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { ConvexClient, type ConvexClientOptions } from 'convex/browser';
import { getContext, onDestroy, setContext } from 'svelte';

type SessionState = {
	data: unknown | null;
	isPending: boolean;
};

type SessionStore = {
	subscribe: (callback: (session: SessionState) => void) => () => void;
};

type FetchAccessToken = (options: { forceRefreshToken: boolean }) => Promise<string | null>;

type AuthClientLike = {
	useSession: () => SessionStore;
	convex: {
		token: () => Promise<{
			data?: {
				token?: string | null;
			} | null;
		}>;
	};
};

export type InitialAuthState = {
	isAuthenticated: boolean;
};

type CreateSvelteAuthClientArgs = {
	authClient: AuthClientLike;
	convexUrl?: string;
	convexClient?: ConvexClient;
	options?: ConvexClientOptions;
	getServerState?: () => InitialAuthState | undefined;
};

type BetterAuthContext = {
	authClient: AuthClientLike;
	fetchAccessToken: FetchAccessToken;
};

type BaseAuthContext = {
	readonly isLoading: boolean;
	readonly isAuthenticated: boolean;
};

const CONVEX_CLIENT_CONTEXT_KEY = '$$_convexClient';
const CONVEX_AUTH_CONTEXT_KEY = '$$_convexAuth';
const BETTER_AUTH_CONTEXT_KEY = Symbol('auth-context');

let browserConvexClient: ConvexClient | null = null;

function getConvexClient(
	convexUrl: string | undefined,
	passedConvexClient: ConvexClient | undefined,
	options?: ConvexClientOptions
): ConvexClient {
	if (passedConvexClient) {
		return passedConvexClient;
	}

	const url = convexUrl ?? PUBLIC_CONVEX_URL;

	if (!browser) {
		return new ConvexClient(url, { disabled: true, ...options });
	}

	browserConvexClient ??= new ConvexClient(url, options);
	return browserConvexClient;
}

export function createSvelteAuthClient({
	authClient,
	convexUrl,
	convexClient,
	options,
	getServerState
}: CreateSvelteAuthClientArgs): void {
	const client = getConvexClient(convexUrl, convexClient, options);
	const serverState = getServerState?.();
	const hasServerState = serverState !== undefined;

	let isLoading = $state(!hasServerState);
	let isAuthenticated = $state(Boolean(serverState?.isAuthenticated));

	const fetchAccessToken: FetchAccessToken = async ({ forceRefreshToken }) => {
		if (!forceRefreshToken) {
			return null;
		}

		const result = await authClient.convex.token();
		return result.data?.token ?? null;
	};

	// Mirror the upstream context keys directly to avoid the packaged setupConvex/setupAuth SSR bug.
	setContext(CONVEX_CLIENT_CONTEXT_KEY, client);

	const baseAuthContext: BaseAuthContext = {
		get isLoading() {
			return isLoading;
		},
		get isAuthenticated() {
			return isAuthenticated;
		}
	};

	const betterAuthContext: BetterAuthContext = {
		authClient,
		fetchAccessToken
	};

	setContext(CONVEX_AUTH_CONTEXT_KEY, baseAuthContext);
	setContext(BETTER_AUTH_CONTEXT_KEY, betterAuthContext);

	if (!browser) {
		return;
	}

	if (serverState?.isAuthenticated) {
		client.setAuth(fetchAccessToken, () => {
			// Keep the initial authenticated socket state during hydration.
		});
	}

	const unsubscribe = authClient.useSession().subscribe((session) => {
		if (session.isPending) {
			isLoading = true;
			return;
		}

		isLoading = false;
		isAuthenticated = Boolean(session.data);

		if (session.data) {
			client.setAuth(fetchAccessToken, () => {
				// The client manages backend auth refresh internally.
			});
			return;
		}

		client.setAuth(
			async () => null,
			() => {
				// Clear auth after sign-out settles.
			}
		);
	});

	onDestroy(() => {
		unsubscribe();
	});
}

export const useAuth = () => {
	const baseAuthContext = getContext<BaseAuthContext | undefined>(CONVEX_AUTH_CONTEXT_KEY);
	const betterAuthContext = getContext<BetterAuthContext | undefined>(BETTER_AUTH_CONTEXT_KEY);

	if (!baseAuthContext || !betterAuthContext) {
		throw new Error(
			'useAuth must be used within a component that has createSvelteAuthClient called in its parent tree'
		);
	}

	return {
		get isLoading() {
			return baseAuthContext.isLoading;
		},
		get isAuthenticated() {
			return baseAuthContext.isAuthenticated;
		},
		fetchAccessToken: betterAuthContext.fetchAccessToken
	};
};
