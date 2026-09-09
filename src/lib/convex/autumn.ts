import { Autumn } from '@useautumn/convex';
import { components } from './_generated/api';
import { authComponent } from './auth';
import type { BillingConfiguration, CapabilityConfiguration } from '../dev/features';
import { CapabilityConfigurationError, requireBillingConfiguration } from './env';

class GuardedAutumn extends Autumn {
	override async getAuthParams(args: Parameters<Autumn['getAuthParams']>[0]) {
		this.options.secretKey = requireBillingConfiguration().secretKey;
		return await super.getAuthParams(args);
	}
}

export const autumn = new GuardedAutumn(components.autumn, {
	// The wrapper does not construct autumn-js until guarded getAuthParams runs.
	secretKey: '',
	identify: async (ctx: Parameters<typeof authComponent.getAuthUser>[0]) => {
		// Get the authenticated user from Better Auth
		const user = await authComponent.getAuthUser(ctx);
		if (!user) return null;

		return {
			customerId: user._id,
			customerData: {
				name: user.name,
				email: user.email
			}
		};
	}
});

export const {
	track,
	cancel,
	query,
	attach,
	check,
	checkout,
	usage,
	setupPayment,
	createCustomer,
	listProducts,
	billingPortal,
	createReferralCode,
	redeemReferralCode,
	createEntity,
	getEntity
} = autumn.api() as any; // Required: library types reference non-portable internal paths (helpers/utils)

/**
 * Get direct Autumn SDK for use in internalActions/scheduled functions
 * where there is no auth context (identify callback returns null).
 *
 * Lazy-loaded to avoid bundling autumn-js into mutation code.
 * Pass explicit customer_id to check/track methods.
 * See: https://github.com/useautumn/autumn-js/issues/51
 */
export async function getAutumnSdk(configuration?: CapabilityConfiguration<BillingConfiguration>) {
	const { secretKey } = requireBillingConfiguration(configuration);
	const { Autumn: AutumnSDK } = await import('autumn-js');
	return new AutumnSDK({ secretKey });
}

/** Outcome of an atomic check-and-count usage call. */
export type UsageCheckOutcome = 'counted' | 'denied' | 'unavailable';

/**
 * Atomically check access to a metered feature and count its usage.
 *
 * Wraps Autumn's `check` with `send_event: true`, which deducts `value`
 * units and computes `allowed` in one server-side operation with
 * overage behavior "reject". Deciding and deducting are a single
 * atomic step on Autumn's side, so concurrent calls serialize there:
 * with N units left, exactly N calls get 'counted' and the rest get
 * 'denied'. A separate check-then-track pair would race instead (all
 * concurrent checks read the same stale balance before any track
 * lands, letting every one of them pass).
 *
 * Outcomes:
 * - 'counted': access granted, `value` units were deducted. The usage
 *   is recorded; no separate track call must follow.
 * - 'denied': access denied or billing is not structurally ready;
 *   nothing was deducted. Configuration failures fail closed.
 * - 'unavailable': a structurally ready Autumn attempt errored (the SDK
 *   returns `data: null` on a non-2xx response and throws on network
 *   failures). Nothing was deducted. Callers fail open rather than
 *   punishing legitimate users for a provider outage.
 *
 * Only valid for metered features with a usage amount known up front
 * (Autumn rejects `send_event` for boolean features and publishable
 * keys). If the operation the usage pays for can still fail afterwards,
 * compensate with `refundUsage` in the failure path.
 */
export async function checkAndCountUsage({
	customerId,
	featureId,
	value = 1
}: {
	customerId: string;
	featureId: string;
	value?: number;
}): Promise<UsageCheckOutcome> {
	let result;
	try {
		const sdk = await getAutumnSdk();
		result = await sdk.check({
			customer_id: customerId,
			feature_id: featureId,
			// Doubles as the deducted amount when send_event is true
			required_balance: value,
			send_event: true
		});
	} catch (error) {
		if (error instanceof CapabilityConfigurationError) return 'denied';
		console.warn(`[checkAndCountUsage] Autumn unreachable for ${featureId}:`, error);
		return 'unavailable';
	}
	if (!result.data) {
		return 'unavailable';
	}
	return result.data.allowed ? 'counted' : 'denied';
}

/** Outcome of a best-effort usage refund. */
export type RefundUsageOutcome =
	| { status: 'refunded' }
	| { status: 'failed'; reason: 'non_2xx'; statusCode: number }
	| { status: 'failed'; reason: 'exception' };

/**
 * Credit back usage previously counted by `checkAndCountUsage`, for
 * when the operation the usage paid for failed afterwards. Negative
 * track values credit the balance (documented Autumn behavior).
 *
 * Best effort: failures return a structured outcome and are logged
 * without request or provider details. They are never thrown, so a
 * refund failure cannot mask the original failure.
 */
export async function refundUsage({
	customerId,
	featureId,
	value = 1
}: {
	customerId: string;
	featureId: string;
	value?: number;
}): Promise<RefundUsageOutcome> {
	let response: Response;
	try {
		const { secretKey } = requireBillingConfiguration();
		response = await fetch('https://api.useautumn.com/v1/track', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/json',
				'x-api-version': '1.2'
			},
			body: JSON.stringify({
				customer_id: customerId,
				feature_id: featureId,
				value: -value
			})
		});
	} catch {
		const failure = { status: 'failed', reason: 'exception' } as const;
		console.error('[refundUsage] Autumn refund failed', failure);
		return failure;
	}
	if (!response.ok) {
		const failure = {
			status: 'failed',
			reason: 'non_2xx',
			statusCode: response.status
		} as const;
		console.error('[refundUsage] Autumn refund failed', failure);
		return failure;
	}
	return { status: 'refunded' };
}
