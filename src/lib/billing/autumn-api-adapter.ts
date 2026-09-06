import type { AutumnConvexApi } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import type { api } from '$lib/convex/_generated/api';

export type AppAutumnApi = typeof api.autumn;

/**
 * convex-autumn-svelte 0.4.0 requires listEvents/aggregateEvents in its type even
 * though initialization and this application's billing flows don't use them.
 * Our published backend intentionally has neither endpoint. Keep that API
 * unchanged and refuse unsupported reads before Convex's proxy fabricates a
 * reference. This is the only cast from our exact registrations to the SDK's
 * broader (and untyped-argument) interface. Remove when the vendor accepts the
 * supported subset; never use this adapter to widen a first-party contract.
 */
export function toAutumnClientApi(published: AppAutumnApi): AutumnConvexApi {
	return new Proxy(published, {
		get(target, property, receiver) {
			if (property === 'listEvents' || property === 'aggregateEvents') {
				throw new Error(`Autumn endpoint ${property} is not published by this application`);
			}
			return Reflect.get(target, property, receiver);
		}
	}) as AutumnConvexApi;
}
