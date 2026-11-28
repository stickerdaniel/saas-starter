import type { AutumnConvexApi } from '@stickerdaniel/convex-autumn-svelte/sveltekit';
import type { api } from '#lib/convex/_generated/api.js';

export type AppAutumnApi = typeof api.autumn;

const PUBLISHED_ENDPOINTS: ReadonlySet<PropertyKey> = new Set<keyof AppAutumnApi>([
	'attach',
	'billingPortal',
	'checkout',
	'createCustomer'
]);

const UNPUBLISHED_ENDPOINTS: ReadonlySet<PropertyKey> = new Set([
	'track',
	'usage',
	'check',
	'cancel',
	'query',
	'setupPayment',
	'listProducts',
	'createReferralCode',
	'redeemReferralCode',
	'createEntity',
	'getEntity',
	'listEvents',
	'aggregateEvents'
]);

/**
 * convex-autumn-svelte types every Autumn endpoint as required, while this
 * application publishes only the four its first-party callers use. Reading
 * another endpoint of the SDK throws before a network call. Any other string
 * key reads as undefined, so the object is neither thenable nor serializable
 * into a reference Convex's proxy would fabricate. This is the only cast from
 * our exact registrations to the SDK's broader (and untyped-argument)
 * interface; never use this adapter to widen a first-party contract.
 */
export function toAutumnClientApi(published: AppAutumnApi): AutumnConvexApi {
	return new Proxy(published, {
		get(target, property, receiver) {
			if (UNPUBLISHED_ENDPOINTS.has(property)) {
				throw new Error(`Autumn endpoint ${String(property)} is not published by this application`);
			}
			if (typeof property === 'string' && !PUBLISHED_ENDPOINTS.has(property)) return undefined;
			return Reflect.get(target, property, receiver);
		}
	}) as AutumnConvexApi;
}
