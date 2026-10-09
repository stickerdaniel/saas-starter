import { describe, expect, it } from 'vitest';
import { normalizeCustomerBilling, type Payment } from './billing';
import { formatAmount } from './compose';
import payingActiveCouponCard from './__fixtures__/autumn/paying-active-coupon-card.json';
import payingScheduledCancelLink from './__fixtures__/autumn/paying-scheduled-cancel-link.json';
import zeroTotalAnnualActive from './__fixtures__/autumn/zero-total-annual-active.json';
import zeroTotalAnnualAfterMonthly from './__fixtures__/autumn/zero-total-annual-after-monthly.json';
import zeroTotalEndedA from './__fixtures__/autumn/zero-total-ended-a.json';
import zeroTotalEndedB from './__fixtures__/autumn/zero-total-ended-b.json';

// The fixtures are Cadenza production reads from 2026-10-07 with the plan ids
// mapped to the template's (provenance inside each file), so the clock sits on
// that day.
const NOW = Date.UTC(2026, 9, 7, 12);
const DAY = 86_400_000;

/** A fork that also sells an annual plan. */
const WITH_ANNUAL = { pro: 'month', pro_annual: 'year' } as const;

describe('normalizeCustomerBilling on measured Autumn reads', () => {
	it('reads a paying monthly customer', () => {
		expect(normalizeCustomerBilling(payingActiveCouponCard.data, NOW)).toEqual({
			kind: 'observed',
			firstPayment: {
				invoiceAt: 1791318993000,
				total: 23.2,
				currency: 'eur',
				planId: 'pro',
				interval: 'month'
			},
			current: { planId: 'pro', interval: 'month' }
		});
	});

	it('reads a scheduled cancellation whose access runs into the future', () => {
		expect(normalizeCustomerBilling(payingScheduledCancelLink.data, NOW)).toEqual({
			kind: 'observed',
			firstPayment: {
				invoiceAt: 1791240829000,
				total: 29,
				currency: 'eur',
				planId: 'pro',
				interval: 'month'
			},
			current: {
				planId: 'pro',
				interval: 'month',
				scheduledCancellation: { canceledAt: 1791312087000, accessUntil: 1793919229000 }
			}
		});
	});

	it('reports no scheduled cancellation once access has ended', () => {
		const ended = NOW + 40 * DAY;
		const result = normalizeCustomerBilling(payingScheduledCancelLink.data, ended);
		expect(result).toMatchObject({ kind: 'observed', current: { planId: 'pro' } });
		expect(result).not.toHaveProperty('current.scheduledCancellation');
	});

	it.each([
		['zero-total-ended-a', zeroTotalEndedA, null],
		['zero-total-ended-b', zeroTotalEndedB, null],
		['zero-total-annual-active', zeroTotalAnnualActive, { planId: 'pro_annual', interval: 'year' }],
		[
			'zero-total-annual-after-monthly',
			zeroTotalAnnualAfterMonthly,
			{ planId: 'pro_annual', interval: 'year' }
		]
	])('finds no payment in %s, which only ever paid zero', (_, fixture, annual) => {
		expect(normalizeCustomerBilling(fixture.data, NOW)).toEqual({
			kind: 'observed',
			firstPayment: null,
			current: null
		});
		expect(normalizeCustomerBilling(fixture.data, NOW, WITH_ANNUAL)).toEqual({
			kind: 'observed',
			firstPayment: null,
			current: annual
		});
	});
});

// Model cases: hand-built variations of the measured shape, not provider observations.
describe('normalizeCustomerBilling on model reads', () => {
	type Invoice = {
		status: string;
		total: unknown;
		currency: string;
		created_at: unknown;
		product_ids: unknown;
	};
	const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
		status: 'paid',
		total: 10,
		currency: 'usd',
		created_at: NOW - 60_000,
		product_ids: ['pro'],
		...overrides
	});
	const product = (overrides: Record<string, unknown> = {}) => ({
		id: 'pro',
		status: 'active',
		canceled_at: null,
		current_period_end: NOW + 30 * DAY,
		...overrides
	});
	const customer = (products: unknown[], invoices: unknown[]) => ({ products, invoices });

	it('takes every payment field from the earliest positive eligible invoice', () => {
		const earliest = NOW - 40 * DAY;
		const result = normalizeCustomerBilling(
			customer(
				[product({ id: 'pro_annual' })],
				[
					invoice({
						total: 120,
						currency: 'eur',
						created_at: NOW - DAY,
						product_ids: ['pro_annual']
					}),
					invoice({ total: 0, created_at: earliest - DAY }),
					invoice({ total: 9.5, currency: 'gbp', created_at: earliest })
				]
			),
			NOW,
			WITH_ANNUAL
		);
		expect(result).toEqual({
			kind: 'observed',
			firstPayment: {
				invoiceAt: earliest,
				total: 9.5,
				currency: 'gbp',
				planId: 'pro',
				interval: 'month'
			},
			current: { planId: 'pro_annual', interval: 'year' }
		});
	});

	it('finds the eligible invoice among earlier unrelated ones', () => {
		const result = normalizeCustomerBilling(
			customer(
				[product()],
				[
					invoice({ total: 50, created_at: NOW - 3 * DAY, product_ids: ['credits'] }),
					invoice({ total: 10, created_at: NOW - DAY, product_ids: ['credits', 'pro'] })
				]
			),
			NOW
		);
		expect(result).toMatchObject({
			kind: 'observed',
			firstPayment: { invoiceAt: NOW - DAY, total: 10, planId: 'pro' }
		});
	});

	it('reports no payment for an unrelated paid invoice beside an active Pro product', () => {
		expect(
			normalizeCustomerBilling(
				customer([product()], [invoice({ total: 50, product_ids: ['credits'] })]),
				NOW
			)
		).toEqual({
			kind: 'observed',
			firstPayment: null,
			current: { planId: 'pro', interval: 'month' }
		});
	});

	it('ignores open and void invoices', () => {
		expect(
			normalizeCustomerBilling(
				customer([product()], [invoice({ status: 'open' }), invoice({ status: 'void' })]),
				NOW
			)
		).toMatchObject({ kind: 'observed', firstPayment: null });
	});

	it('has no current product while the eligible one is only scheduled', () => {
		expect(
			normalizeCustomerBilling(customer([product({ status: 'scheduled' })], [invoice()]), NOW)
		).toMatchObject({ kind: 'observed', current: null });
	});

	it('does not report a cancellation while a scheduled eligible product would still bill', () => {
		const result = normalizeCustomerBilling(
			customer(
				[
					product({ canceled_at: NOW - 60_000 }),
					product({ id: 'pro_annual', status: 'scheduled' })
				],
				[invoice()]
			),
			NOW,
			WITH_ANNUAL
		);
		expect(result).toEqual({
			kind: 'observed',
			firstPayment: expect.objectContaining({ planId: 'pro' }),
			current: { planId: 'pro', interval: 'month' }
		});
	});

	it.each([
		['a future cancellation stamp', [invoice()], [product({ canceled_at: NOW + 3_600_000 })]],
		['a future payment', [invoice({ created_at: NOW + 3_600_000 })], [product()]],
		['an infinite invoice total', [invoice({ total: Number.POSITIVE_INFINITY })], [product()]],
		['a NaN invoice total', [invoice({ total: Number.NaN })], [product()]],
		['a string invoice total', [invoice({ total: '10' })], [product()]],
		['a NaN invoice time', [invoice({ created_at: Number.NaN })], [product()]],
		['invoice products that are not a list', [invoice({ product_ids: 'pro' })], [product()]],
		['a blank currency', [invoice({ currency: ' ' })], [product()]],
		[
			'an infinite cancellation time',
			[invoice()],
			[product({ canceled_at: Number.NEGATIVE_INFINITY })]
		],
		[
			'a NaN period end on a scheduled cancellation',
			[invoice()],
			[product({ canceled_at: NOW - 60_000, current_period_end: Number.NaN })]
		]
	])('rejects %s', (_, invoices, products) => {
		expect(normalizeCustomerBilling(customer(products, invoices), NOW).kind).toBe('malformed');
	});

	it.each([null, 'customer', { products: [] }, { invoices: [] }, { products: [1], invoices: [] }])(
		'rejects a read without both lists of records: %j',
		(data) => {
			expect(normalizeCustomerBilling(data, NOW).kind).toBe('malformed');
		}
	);
});

describe('payment amounts', () => {
	const payment = (total: number, currency: string): Payment => ({
		invoiceAt: NOW,
		total,
		currency,
		planId: 'pro',
		interval: 'month'
	});

	it('formats the invoice total in its own currency and the reader locale', () => {
		expect(formatAmount(payment(23.2, 'eur'), 'en')).toBe('€23.20');
		expect(formatAmount(payment(23.2, 'eur'), 'de')).toBe('23,20 €');
		expect(formatAmount(payment(10, 'usd'), 'fr')).toBe('10,00 $US');
	});

	it('still shows the amount for a currency code the runtime rejects', () => {
		expect(formatAmount(payment(5, 'not-a-currency'), 'en')).toBe('5.00 not-a-currency');
	});
});
