import { describe, expect, expectTypeOf, it } from 'vitest';
import { getFunctionName } from 'convex/server';
import { api } from '#lib/convex/_generated/api.js';
import { toAutumnClientApi, type AppAutumnApi } from './autumn-api-adapter';

const publishedKeys = ['attach', 'billingPortal', 'checkout', 'createCustomer'] as const;

const unpublishedKeys = [
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
	it.each(unpublishedKeys)('refuses unpublished %s before a network call', (key) => {
		const adapted = toAutumnClientApi(api.autumn);
		expect(() => adapted[key]).toThrow(
			`Autumn endpoint ${key} is not published by this application`
		);
	});
	it('resolves and serializes without fabricating a reference', async () => {
		const adapted = toAutumnClientApi(api.autumn);
		await expect(Promise.resolve(adapted)).resolves.toBe(adapted);
		expect(JSON.stringify(adapted)).toBe('{}');
		expect(adapted.listCustomers).toBeUndefined();
	});
});
