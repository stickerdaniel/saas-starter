import { t, type SupportedLocale } from '../../i18n/translations';
import type { RailTheme } from '../../emails/journeyTimeline';
import { coverageNotes, orderSteps, pickTiles, type PresentedJourney } from '../journey/collect';
import { formatDuration, type JourneyFormat } from '../journey/format';
import type { JourneyMetric, JourneyRequest, JourneyStep } from '../journey/source';
import { JOURNEY_RAIL_THEME, JOURNEY_TILE_THEME, type TileTheme } from '../journey/theme';
import type { FrozenBilling, Payment } from './billing';

/**
 * Builds the journey part of an admin customer email from a ledger row and
 * the presented sources, per recipient. The only place that knows both the
 * billing facts and the sources: it adds the billing milestones, decides
 * where they sit among source steps, and picks the lead tiles and the inbox
 * preview. The template renders what it returns.
 */

/** The tiles, the ordered rail and its notes, and the colours they render in. */
export type ComposedJourney = {
	tiles: JourneyMetric[];
	steps: JourneyStep[];
	notes: string[];
	theme: { rail: RailTheme; tiles: TileTheme };
};

export type ComposedNewCustomer = {
	amount: string;
	previewText: string;
	journey: ComposedJourney;
};

/** The invoice total in its own currency, in the recipient's locale. */
export function formatAmount({ total, currency }: Payment, locale: SupportedLocale): string {
	try {
		return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(total);
	} catch {
		// A currency code the runtime does not know still shows the amount.
		const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(total);
		return `${number} ${currency}`;
	}
}

/** The plan's display name from the pricing copy, or its id when it has none. */
function planName(planId: string, locale: SupportedLocale): string {
	const key = `pricing.tiers.${planId}.name`;
	const name = t(locale, key);
	return name === key ? planId : name;
}

/**
 * The steps the billing facts add. At equal times they keep this order and
 * come before source steps, so signup opens the rail and the payment leads
 * whatever happened at the same instant.
 */
function milestones(
	billing: FrozenBilling,
	request: JourneyRequest,
	amount: string,
	locale: SupportedLocale
): JourneyStep[] {
	const { firstPayment } = billing;
	return [
		{
			key: 'signup:signed_up',
			at: request.signupAt,
			title: t(locale, 'email.customer_journey.milestone.signed_up'),
			lines: [],
			tone: 'neutral'
		},
		{
			key: 'paid:paid',
			at: firstPayment.invoiceAt,
			title: t(locale, 'email.customer_journey.milestone.paid', { amount }),
			lines: [
				t(locale, `email.customer_journey.milestone.plan.${firstPayment.interval}`, {
					plan: planName(firstPayment.planId, locale)
				})
			],
			tone: 'paid'
		}
	];
}

/**
 * The inbox preview: the counted tiles, such as "14 AI chat messages before
 * paying", or how long the customer took to pay when no tile has a count. A
 * tile without a count is unknown and a zero says nothing, so neither is named.
 */
function previewText(tiles: readonly JourneyMetric[], duration: string, locale: SupportedLocale) {
	const counted = tiles.filter((tile) => tile.count && tile.count.n > 0);
	return counted.length > 0
		? counted.map((tile) => `${tile.value} ${tile.label}`).join(', ')
		: t(locale, 'email.new_customer.preview', { duration });
}

/** The new-customer email's journey: signup, the payment, then the sources in registry order. */
export function composeNewCustomer(args: {
	billing: FrozenBilling;
	presented: PresentedJourney;
	format: JourneyFormat;
}): ComposedNewCustomer {
	const { billing, presented, format } = args;
	const { request } = presented;
	const { locale } = format;
	const amount = formatAmount(billing.firstPayment, locale);
	const duration = formatDuration(billing.firstPayment.invoiceAt - request.signupAt, locale);
	const lead: JourneyMetric = {
		key: 'paid:signup_to_paid',
		label: t(locale, 'email.customer_journey.milestone.signup_to_paid'),
		value: duration
	};
	const tiles = pickTiles([lead], presented);
	return {
		amount,
		previewText: previewText(tiles, duration, locale),
		journey: {
			tiles,
			steps: orderSteps([
				...milestones(billing, request, amount, locale),
				...presented.sources.flatMap((source) => source.steps)
			]),
			notes: coverageNotes(presented, format),
			theme: { rail: JOURNEY_RAIL_THEME, tiles: JOURNEY_TILE_THEME }
		}
	};
}
