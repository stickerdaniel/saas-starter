import { env } from '$env/dynamic/private';
import { createConvexHttpClient } from '@mmailaender/convex-better-auth-svelte/sveltekit';

export function createServerConvexHttpClient(args: { token?: string }) {
	return createConvexHttpClient({
		token: args.token,
		convexUrl: env.CONVEX_INTERNAL_URL || undefined
	});
}
