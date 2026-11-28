import type { AutumnConvexApi } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import type { api } from '#lib/convex/_generated/api.js';

export type AppAutumnApi = typeof api.autumn;

const PUBLISHED_ENDPOINTS: ReadonlySet<PropertyKey> = new Set<keyof AppAutumnApi>([
	'attach',
	'billingPortal',
	'checkout',
	'createCustomer'
]);

/**
 * convex-autumn-svelte types every Autumn endpoint as required, while this
 * application publishes only the four its client code calls. Reading any other
 * endpoint name throws before Convex's proxy fabricates a reference to a
 * function the backend does not have. This is the only cast from our exact
 * registrations to the SDK's broader (and untyped-argument) interface; never
 * use this adapter to widen a first-party contract.
 */
export function toAutumnClientApi(published: AppAutumnApi): AutumnConvexApi {
	return new Proxy(published, {
		get(target, property, receiver) {
			if (typeof property === 'string' && !PUBLISHED_ENDPOINTS.has(property)) {
				throw new Error(`Autumn endpoint ${property} is not published by this application`);
			}
			return Reflect.get(target, property, receiver);
		}
	}) as AutumnConvexApi;
}
