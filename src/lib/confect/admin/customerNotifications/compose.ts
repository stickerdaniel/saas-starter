import { t, type SupportedLocale } from '../../i18n/translations';
import type { RailTheme } from '../../emails/journeyTimeline';
import { coverageNotes, orderSteps, pickTiles, type PresentedJourney } from '../journey/collect';
import { createClock, formatDuration, type JourneyFormat } from '../journey/format';
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

export type ComposedCancellation = {
	/** From the payment to the cancellation. */
	duration: string;
	previewText: string;
	journey: ComposedJourney;
};

type ComposeArgs = {
	billing: FrozenBilling;
	presented: PresentedJourney;
	format: JourneyFormat;
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
 * The step that closes a cancellation's rail, at the cancellation (the
 * window's end), with the day access ends when the billing read had one.
 */
function canceledStep(
	billing: FrozenBilling,
	request: JourneyRequest,
	format: JourneyFormat
): JourneyStep {
	const { locale } = format;
	const accessUntil = billing.current?.scheduledCancellation?.accessUntil;
	return {
		key: 'canceled:canceled',
		at: request.window.end,
		title: t(locale, 'email.customer_journey.milestone.canceled'),
		lines:
			accessUntil === undefined
				? []
				: [
						t(locale, 'email.customer_journey.milestone.access_until', {
							date: createClock(format).date(accessUntil)
						})
					],
		tone: 'canceled'
	};
}

/**
 * The inbox preview: the counted tiles, such as "14 AI chat messages before
 * paying", or `fallback` when no tile has a count. A tile without a count is
 * unknown and a zero says nothing, so neither is named.
 */
function previewText(tiles: readonly JourneyMetric[], fallback: string) {
	const counted = tiles.filter((tile) => tile.count && tile.count.n > 0);
	return counted.length > 0
		? counted.map((tile) => `${tile.value} ${tile.label}`).join(', ')
		: fallback;
}

/** The lead tile and the source tiles, the rail in time order, and its notes. */
function composeJourney(
	lead: JourneyMetric,
	steps: readonly JourneyStep[],
	{ presented, format }: Pick<ComposeArgs, 'presented' | 'format'>
): ComposedJourney {
	return {
		tiles: pickTiles([lead], presented),
		steps: orderSteps(steps),
		notes: coverageNotes(presented, format),
		theme: { rail: JOURNEY_RAIL_THEME, tiles: JOURNEY_TILE_THEME }
	};
}

const sourceSteps = (presented: PresentedJourney) =>
	presented.sources.flatMap((source) => source.steps);

/** The new-customer email's journey: signup, the payment, then the sources in registry order. */
export function composeNewCustomer(args: ComposeArgs): ComposedNewCustomer {
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
	const journey = composeJourney(
		lead,
		[...milestones(billing, request, amount, locale), ...sourceSteps(presented)],
		args
	);
	return {
		amount,
		previewText: previewText(journey.tiles, t(locale, 'email.new_customer.preview', { duration })),
		journey
	};
}

/**
 * The cancellation email's journey: signup and the payment, shown even when
 * they fall before the window, the sources in registry order, then the
 * cancellation, which closes the rail at equal times.
 */
export function composeCancellation(args: ComposeArgs): ComposedCancellation {
	const { billing, presented, format } = args;
	const { request } = presented;
	const { locale } = format;
	const amount = formatAmount(billing.firstPayment, locale);
	const duration = formatDuration(request.window.end - request.paymentAt, locale);
	const lead: JourneyMetric = {
		key: 'canceled:paid_to_canceled',
		label: t(locale, 'email.customer_journey.milestone.paid_to_canceled'),
		value: duration
	};
	const journey = composeJourney(
		lead,
		[
			...milestones(billing, request, amount, locale),
			...sourceSteps(presented),
			canceledStep(billing, request, format)
		],
		args
	);
	return {
		duration,
		previewText: previewText(journey.tiles, t(locale, 'email.cancellation.preview', { duration })),
		journey
	};
}
