import { describe, expect, expectTypeOf, it } from 'vitest';
import { getFunctionName } from 'convex/server';
import { api } from '$lib/convex/_generated/api';
import { toAutumnClientApi, type AppAutumnApi } from './autumn-api-adapter';

const publishedKeys = [
	'track',
	'cancel',
	'query',
	'attach',
	'check',
	'checkout',
	'usage',
	'setupPayment',
	'createCustomer',
	'listProducts',
	'billingPortal',
	'createReferralCode',
	'redeemReferralCode',
	'createEntity',
	'getEntity'
] as const;

describe('Autumn SDK endpoint adapter', () => {
	it('keeps exactly the published backend contract at its input', () => {
		expectTypeOf<keyof AppAutumnApi>().toEqualTypeOf<(typeof publishedKeys)[number]>();
		expectTypeOf<Parameters<typeof toAutumnClientApi>[0]>().toEqualTypeOf<typeof api.autumn>();
	});
	it.each(publishedKeys)('passes the %s reference to the SDK unchanged', (key) => {
		const adapted = toAutumnClientApi(api.autumn);
		expect(getFunctionName(adapted[key])).toBe(getFunctionName(api.autumn[key]));
		expect(getFunctionName(adapted[key])).toBe(`autumn:${key}`);
	});
	it.each(['listEvents', 'aggregateEvents'] as const)(
		'refuses unpublished %s before a network call',
		(key) => {
			const adapted = toAutumnClientApi(api.autumn);
			expect(() => adapted[key]).toThrow(`Autumn endpoint ${key} is not published`);
		}
	);
});
