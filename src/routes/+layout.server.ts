import type { LayoutServerLoad } from './$types';
import { api } from '$lib/convex/_generated/api';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { createAutumnHandlers } from '@stickerdaniel/convex-autumn-svelte/sveltekit/server';

type JwtViewer = {
	_id: string;
	name?: string | null;
	email?: string | null;
	image?: string | null;
	role?: string;
	emailVerified?: boolean;
	createdAt?: number;
	updatedAt?: number;
	banned?: boolean;
	locale?: string;
};

function getViewerFromJwt(token: string | undefined): JwtViewer | null {
	if (!token) return null;

	try {
		const payload = token.split('.')[1];
		if (!payload) return null;

		const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
			sub?: string;
			name?: string;
			email?: string;
			image?: string | null;
			role?: string;
			emailVerified?: boolean;
			createdAt?: number;
			updatedAt?: number;
			banned?: boolean;
			locale?: string;
		};

		if (!decoded.sub) return null;

		return {
			_id: decoded.sub,
			name: decoded.name ?? null,
			email: decoded.email ?? null,
			image: decoded.image ?? null,
			role: decoded.role,
			emailVerified: decoded.emailVerified,
			createdAt: decoded.createdAt,
			updatedAt: decoded.updatedAt,
			banned: decoded.banned,
			locale: decoded.locale
		};
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = async (event) => {
	// Enables targeted invalidation via invalidate('autumn:customer') to refetch only customer data
	event.depends('autumn:customer');

	// Check if JWT token exists (set by handleAuth in hooks.server.ts)
	const isAuthenticated = !!event.locals.token;
	const authState = { isAuthenticated };
	const fallbackViewer = getViewerFromJwt(event.locals.token);

	// Only create Convex/Autumn clients when authenticated (avoids invalid URL during prerendering)
	let customer = null;
	let viewer = null;

	if (isAuthenticated) {
		const client = createConvexHttpClient({ token: event.locals.token });

		const { getCustomer } = createAutumnHandlers({
			convexApi: (api as any).autumn,
			createClient: () => client
		});

		// Fetch customer and viewer in PARALLEL for faster initial load
		// Wrap in try-catch to handle failures gracefully (e.g., in CI)
		[customer, viewer] = await Promise.all([
			getCustomer(event).catch((e) => {
				console.error('[+layout.server.ts] Autumn getCustomer failed:', e);
				return null;
			}),
			client.query(api.auth.getCurrentUser, {}).catch((e) => {
				console.error('[+layout.server.ts] Viewer lookup failed, falling back to JWT payload:', e);
				return fallbackViewer;
			})
		]);
	}

	return {
		authState,
		autumnState: {
			customer,
			_timeFetched: Date.now()
		},
		viewer
	};
};
